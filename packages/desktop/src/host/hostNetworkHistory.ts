/**
 * Host 出站流量抓取（socket 级 + 命令行意图级，Network 面板）。
 *
 * undici diagnostics 只能看到本进程的 fetch，但 ZCode 的模型调用与工具（WebFetch、
 * 被模型 spawn 的 curl/wget 等）都跑在 Host 派生的 zcode-cli 子进程里。这里在 Host 侧
 * 按进程树轮询，两条采集互补：
 *   A) lsof 抓已建立的 TCP 连接——覆盖长连接（模型流式调用）及任意进程的 socket；
 *   B) 命令行里的 http(s) URL——覆盖瞬时短连接（curl/wget 0.x 秒内结束，socket 常被轮询错过），
 *      只要进程被看到一次就按其 argv 目标出一条记录，captures 意图而非依赖 socket 时序。
 *
 * TLS 下拿不到方法/头。域名按优先级补齐：命令行 URL 主机 > ZCode 端点正向映射 > PTR > IP。
 * 真正零遗漏需内核态抓包(SYN)，属特权范畴，这里是无特权最佳努力。
 */
import { execFile } from "node:child_process";
import { reverse as dnsReverse, lookup as dnsLookup } from "node:dns/promises";
import { HostResponseTypes, NETWORK_HISTORY_BATCH_MAX } from "@zcode/shared";
import type { NetworkHistoryEntry } from "@zcode/shared";

interface HostNetworkHistoryParentPort {
  postMessage(message: unknown): void;
}

interface CmdTarget {
  pid: number;
  command: string;
  host: string;
  protocol: string;
  port: number;
}

const POLL_INTERVAL_MS = 400;
const FORWARD_REFRESH_MS = 5 * 60_000;
const FLUSH_MAX_BATCH = NETWORK_HISTORY_BATCH_MAX;
const LSOF_BIN = "/usr/sbin/lsof";
const PS_BIN = "/bin/ps";
const DEFAULT_FORWARD_DOMAINS = ["api.z.ai", "chat.z.ai", "z.ai", "open.bigmodel.cn"];

const pending: NetworkHistoryEntry[] = [];
const active = new Map<string, NetworkHistoryEntry>();
const ptrCache = new Map<string, string | null>();
const forwardMap = new Map<string, string>(); // ip -> 域名（ZCode 端点正向解析）
const hostResolveCache = new Map<string, { addr: string; cls: NetworkHistoryEntry["classification"] }>();
let hostHints = new Map<number, string>(); // pid -> 命令行 URL 主机
let pollTimer: ReturnType<typeof setInterval> | null = null;
let forwardTimer: ReturnType<typeof setInterval> | null = null;
let activeParentPort: HostNetworkHistoryParentPort | null = null;
let polling = false;

function classify(ip: string): NetworkHistoryEntry["classification"] {
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.")) return "loopback";
  if (ip.startsWith("::ffff:127.")) return "loopback";
  const v4 = ip.replace(/^::ffff:/i, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(v4);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return "lan";
    if (a === 192 && b === 168) return "lan";
    if (a === 172 && b >= 16 && b <= 31) return "lan";
    if (a === 169 && b === 254) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "tailscale";
    return "external";
  }
  if (/^fe80:/i.test(ip)) return "private";
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return "private";
  if (ip.includes(":")) return "external";
  return "unknown";
}

function protocolForPort(port: number): string {
  switch (port) {
    case 443:
      return "HTTPS";
    case 80:
    case 8080:
    case 8888:
      return "HTTP";
    case 22:
      return "SSH";
    case 53:
      return "DNS";
    default:
      return "TCP";
  }
}

function nameFor(addr: string, pid: number): string {
  const hint = hostHints.get(pid);
  if (hint) return hint;
  const fwd = forwardMap.get(addr);
  if (fwd) return fwd;
  const ptr = ptrCache.get(addr);
  if (ptr) return ptr;
  return addr;
}

function enqueue(entry: NetworkHistoryEntry): void {
  pending.push({ ...entry });
  if (pending.length >= FLUSH_MAX_BATCH) flush();
}

function flush(): void {
  if (!activeParentPort || pending.length === 0) return;
  const entries = pending.splice(0, FLUSH_MAX_BATCH);
  try {
    activeParentPort.postMessage({ type: HostResponseTypes.NetworkHistoryBatch, entries });
  } catch {
    // 回传失败不应影响 host 主流程。
  }
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout: 5_000 }, (_err, stdout) => {
      resolve(stdout ?? "");
    });
  });
}

/** 从命令行提取 http(s) URL 的主机/协议/端口。 */
function extractUrlFromCommand(command: string): { host: string; protocol: string; port: number } | undefined {
  const m = /(https?):\/\/([^/\s'"]+)/i.exec(command);
  if (!m || !m[1] || !m[2]) return undefined;
  const scheme = m[1].toLowerCase();
  let hostPort = m[2].replace(/^[^@]*@/, "");
  let port = scheme === "https" ? 443 : 80;
  const pm = /:(\d+)$/.exec(hostPort);
  if (pm) {
    port = Number(pm[1]);
    hostPort = hostPort.replace(/:\d+$/, "");
  }
  return { host: hostPort, protocol: scheme === "https" ? "HTTPS" : "HTTP", port };
}

/** 一次 ps 同时拿进程树、命令行 URL 提示与命令行抓取目标。 */
async function scanProcesses(): Promise<{
  pids: number[];
  hints: Map<number, string>;
  cmdTargets: CmdTarget[];
}> {
  const out = await run(PS_BIN, ["-axww", "-o", "pid=,ppid=,command="]);
  const children = new Map<number, number[]>();
  const hints = new Map<number, string>();
  const cmdTargets: CmdTarget[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstSpace = trimmed.indexOf(" ");
    const pid = Number(trimmed.slice(0, firstSpace));
    const rest = trimmed.slice(firstSpace + 1).trim();
    const secondSpace = rest.indexOf(" ");
    const ppid = Number(secondSpace === -1 ? rest : rest.slice(0, secondSpace));
    const command = secondSpace === -1 ? "" : rest.slice(secondSpace + 1);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    let siblings = children.get(ppid);
    if (!siblings) {
      siblings = [];
      children.set(ppid, siblings);
    }
    siblings.push(pid);
    const url = extractUrlFromCommand(command);
    if (url) {
      hints.set(pid, url.host);
      // command 的首 token 作进程名（去路径）。
      const comm = command.split(/\s+/)[0]?.split("/").pop() || "cmd";
      cmdTargets.push({ pid, command: comm, host: url.host, protocol: url.protocol, port: url.port });
    }
  }
  const root = process.pid;
  const result = new Set<number>([root]);
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  const descendants = new Set(result);
  // 只保留本进程树内的抓取目标。
  return { pids: [...result], hints, cmdTargets: cmdTargets.filter((t) => descendants.has(t.pid)) };
}

function parseRemote(name: string): { addr: string; port: number } | null {
  const arrow = name.split("->")[1];
  if (!arrow) return null;
  const target = arrow.trim();
  const idx = target.lastIndexOf(":");
  if (idx <= 0) return null;
  let addr = target.slice(0, idx);
  const port = Number(target.slice(idx + 1));
  if (!Number.isInteger(port)) return null;
  addr = addr.replace(/^\[/, "").replace(/\]$/, "");
  return { addr, port };
}

function scheduleReverseDns(ip: string): void {
  if (ptrCache.has(ip)) return;
  ptrCache.set(ip, null);
  void dnsReverse(ip)
    .then((names) => {
      if (names[0]) ptrCache.set(ip, names[0]);
    })
    .catch(() => {});
}

/** 命令行目标主机的分类猜测（解析前）：私有/本机字面量按内网，否则按公网。 */
function guessClassForHost(host: string): NetworkHistoryEntry["classification"] {
  if (host === "localhost" || host.startsWith("127.")) return "loopback";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return classify(host);
  if (/\.(local|lan|internal)$/i.test(host)) return "lan";
  return "external";
}

/** 正向解析命令行目标主机，补 IP 与准确分类。 */
function scheduleHostResolve(host: string, entryId: string): void {
  const cached = hostResolveCache.get(host);
  if (cached) return;
  hostResolveCache.set(host, { addr: host, cls: guessClassForHost(host) });
  void dnsLookup(host)
    .then(({ address }) => {
      const cls = classify(address);
      hostResolveCache.set(host, { addr: address, cls });
      const entry = active.get(entryId);
      if (entry) {
        entry.remoteAddr = address;
        entry.classification = cls;
        enqueue(entry);
      }
    })
    .catch(() => {});
}

async function refreshForwardMap(): Promise<void> {
  const domains = new Set(DEFAULT_FORWARD_DOMAINS);
  for (const value of Object.values(process.env)) {
    const url = value ? extractUrlFromCommand(value) : undefined;
    if (url) domains.add(url.host);
  }
  for (const domain of domains) {
    try {
      const addrs = await dnsLookup(domain, { all: true });
      for (const a of addrs) forwardMap.set(a.address, domain);
    } catch {
      // 忽略解析失败。
    }
  }
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { pids, hints, cmdTargets } = await scanProcesses();
    hostHints = hints;
    if (pids.length === 0) return;
    const now = Date.now();
    const seen = new Set<string>();

    // A) 命令行抓取目标（覆盖瞬时短连接）。
    for (const t of cmdTargets) {
      const id = `cmd:${t.pid}:${t.host}:${t.port}`;
      seen.add(id);
      if (active.has(id)) {
        active.get(id)!.lastSeenAt = now;
        continue;
      }
      const resolved = hostResolveCache.get(t.host);
      const entry: NetworkHistoryEntry = {
        id,
        state: "active",
        startedAt: now,
        lastSeenAt: now,
        protocol: t.protocol,
        remoteHost: t.host,
        remoteAddr: resolved?.addr ?? t.host,
        remotePort: t.port,
        process: t.command,
        pid: t.pid,
        classification: resolved?.cls ?? guessClassForHost(t.host),
      };
      active.set(id, entry);
      enqueue(entry);
      scheduleHostResolve(t.host, id);
    }

    // B) lsof 已建立连接（覆盖长连接 / 任意 socket）。
    const out = await run(LSOF_BIN, ["-nP", "-Fpcfn", "-iTCP", "-a", "-p", pids.join(",")]);
    let curPid = 0;
    let curCommand = "";
    let curFd = "";
    for (const line of out.split("\n")) {
      const tag = line[0];
      const value = line.slice(1);
      if (tag === "p") {
        curPid = Number(value) || 0;
      } else if (tag === "c") {
        curCommand = value;
      } else if (tag === "f") {
        curFd = value;
      } else if (tag === "n") {
        const remote = parseRemote(value);
        if (!remote || curPid === 0) continue;
        const id = `${curPid}:${curFd}:${remote.addr}:${remote.port}`;
        seen.add(id);
        const name = nameFor(remote.addr, curPid);
        const existing = active.get(id);
        if (existing) {
          existing.lastSeenAt = now;
          if (existing.remoteHost !== name && name !== remote.addr) {
            existing.remoteHost = name;
            enqueue(existing);
          }
          continue;
        }
        const entry: NetworkHistoryEntry = {
          id,
          state: "active",
          startedAt: now,
          lastSeenAt: now,
          protocol: protocolForPort(remote.port),
          remoteHost: name,
          remoteAddr: remote.addr,
          remotePort: remote.port,
          process: curCommand,
          pid: curPid,
          classification: classify(remote.addr),
        };
        active.set(id, entry);
        enqueue(entry);
        if (entry.classification === "external" || entry.classification === "tailscale") {
          scheduleReverseDns(remote.addr);
        }
      }
    }

    for (const [id, entry] of active) {
      if (!seen.has(id)) {
        entry.state = "closed";
        enqueue(entry);
        active.delete(id);
      }
    }
    flush();
  } finally {
    polling = false;
  }
}

export function registerHostNetworkHistory(
  parentPort: HostNetworkHistoryParentPort | null | undefined,
): void {
  activeParentPort = parentPort ?? null;
  if (process.platform !== "darwin") return;
  void refreshForwardMap();
  forwardTimer = setInterval(() => void refreshForwardMap(), FORWARD_REFRESH_MS);
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

export function stopHostNetworkHistory(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (forwardTimer) {
    clearInterval(forwardTimer);
    forwardTimer = null;
  }
  active.clear();
  flush();
  activeParentPort = null;
}
