import { z } from "zod";

/** 渲染端环形缓冲最多保留的出站连接条目数；超出后丢弃最旧的。 */
export const NETWORK_HISTORY_LIMIT = 1000;
/** Host → Main 单批最多携带的条目数，避免一次 postMessage 过大。 */
export const NETWORK_HISTORY_BATCH_MAX = 500;

const nonNegative = z.number().finite().nonnegative();

/**
 * 一条出站网络连接的抓取记录（socket 级，Burp HTTP history 风格的“流量历史”）。
 *
 * 由 Host 轮询自身及其全部子进程（agent / 工具 / 被模型 spawn 的 curl 等）的 socket
 * 得到，因此覆盖 undici 看不到的 spawn 进程流量。TLS 下看不到 HTTP 方法/路径/头，
 * 所以只记录对端主机/IP/端口/协议/进程与归类。`state` 表示连接是否仍活跃。
 */
export const networkHistoryEntrySchema = z
  .object({
    /** 稳定唯一 id：pid + 对端地址:端口；同一连接的后续更新用同 id 覆盖。 */
    id: z.string(),
    state: z.enum(["active", "closed"]),
    /** 首次观察到的时间（epoch 毫秒）。 */
    startedAt: nonNegative,
    /** 最近一次仍观察到的时间（epoch 毫秒）。 */
    lastSeenAt: nonNegative,
    /** 由端口推断的协议：HTTPS / HTTP / TLS / TCP。 */
    protocol: z.string(),
    /** 对端反查域名（成功时），否则与 remoteAddr 相同。 */
    remoteHost: z.string(),
    /** 对端 IP。 */
    remoteAddr: z.string(),
    remotePort: nonNegative,
    /** 发起连接的进程命令名，如 zcode-cli / curl / node。 */
    process: z.string(),
    pid: nonNegative,
    /** 归类：external=公网出口（重点关注），其余为本机/内网/回环。 */
    classification: z.enum(["external", "lan", "tailscale", "loopback", "private", "unknown"]),
  })
  .strict();

export type NetworkHistoryEntry = z.infer<typeof networkHistoryEntrySchema>;

export const networkHistoryBatchSchema = z
  .object({
    entries: z.array(networkHistoryEntrySchema).max(NETWORK_HISTORY_BATCH_MAX),
  })
  .strict();

export type NetworkHistoryBatch = z.infer<typeof networkHistoryBatchSchema>;
