/* oxlint-disable eslint(max-lines) -- Network 面板集中承载抓取表格、过滤与行展开，后续再按区块拆分。 */
/**
 * NetworkHistoryPane —— ZCode 出站流量面板（socket 级，Burp HTTP history 风格）。
 *
 * 数据来自 Host 按进程树轮询 lsof 得到的出站连接（覆盖模型调用、WebFetch、以及被模型
 * spawn 的 curl 等工具进程），经 store 常驻订阅。本面板只负责展示：协议/归类彩色胶囊、
 * 实时过滤、仅公网、行展开查看对端 IP / 进程 / 首末观察时间。
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { NetworkIcon, SearchIcon, Trash2Icon, ChevronRightIcon, GlobeIcon } from "lucide-react";
import type { NetworkHistoryEntry } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  ensureNetworkHistorySubscription,
  useNetworkHistoryStore,
} from "@/store/networkHistoryStore.js";
import { cn } from "@/components/lib/utils.js";

function formatTime(locale: string, startedAt: number): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(startedAt));
}

function protocolPillClass(protocol: string): string {
  switch (protocol) {
    case "HTTPS":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case "HTTP":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-300";
    case "SSH":
      return "bg-violet-500/15 text-violet-600 dark:text-violet-300";
    case "DNS":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
    default:
      return "bg-foreground/10 text-foreground-subtle";
  }
}

function classBadgeClass(classification: NetworkHistoryEntry["classification"]): string {
  switch (classification) {
    case "external":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-300";
    case "tailscale":
      return "bg-violet-500/15 text-violet-600 dark:text-violet-300";
    case "lan":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
    default:
      return "bg-foreground/10 text-foreground-subtle";
  }
}

function classLabelId(classification: NetworkHistoryEntry["classification"]): string {
  return `networkHistory.class.${classification}`;
}

export function NetworkHistoryPane() {
  const { intl, locale } = useZCodeIntl();
  const platform = usePlatform();
  const entries = useNetworkHistoryStore((state) => state.entries);
  const clear = useNetworkHistoryStore((state) => state.clear);
  const [filter, setFilter] = useState("");
  const [externalOnly, setExternalOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    ensureNetworkHistorySubscription(platform);
  }, [platform]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (externalOnly && entry.classification !== "external") return false;
      if (!needle) return true;
      return (
        entry.remoteHost.toLowerCase().includes(needle) ||
        entry.remoteAddr.toLowerCase().includes(needle) ||
        entry.process.toLowerCase().includes(needle) ||
        entry.protocol.toLowerCase().includes(needle) ||
        String(entry.remotePort).includes(needle)
      );
    });
    return filtered.reverse(); // 最新置顶
  }, [entries, filter, externalOnly]);

  const externalCount = useMemo(
    () => entries.filter((e) => e.classification === "external").length,
    [entries],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="network-history-pane">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <NetworkIcon className="size-4 text-foreground-subtle" aria-hidden="true" />
        <h2 className="text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "networkHistory.title" })}
        </h2>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 font-mono text-ui-xs text-foreground-subtle">
          {new Intl.NumberFormat(locale).format(entries.length)}
        </span>
        {externalCount > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-mono text-ui-xs text-rose-600 dark:text-rose-300">
            <GlobeIcon className="size-3" aria-hidden="true" />
            {new Intl.NumberFormat(locale).format(externalCount)}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExternalOnly((value) => !value)}
            className={cn(
              "rounded-md px-2 py-1 text-ui-xs font-medium transition-colors",
              externalOnly
                ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
                : "text-foreground-subtle hover:bg-foreground/5",
            )}
          >
            {intl.formatMessage({ id: "networkHistory.externalOnly" })}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={entries.length === 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-ui-xs font-medium text-foreground-subtle transition-colors hover:bg-foreground/5 disabled:opacity-40"
          >
            <Trash2Icon className="size-3.5" aria-hidden="true" />
            {intl.formatMessage({ id: "networkHistory.clear" })}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <SearchIcon className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden="true" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={intl.formatMessage({ id: "networkHistory.filterPlaceholder" })}
          className="min-w-0 flex-1 bg-transparent font-mono text-ui-xs text-foreground outline-none placeholder:text-foreground-subtle"
        />
        <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "networkHistory.hint" })}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <NetworkIcon className="size-6 text-foreground-subtle/50" aria-hidden="true" />
          <div className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "networkHistory.empty" })}
          </div>
          <div className="text-ui-xs text-foreground-subtle/70">
            {intl.formatMessage({ id: "networkHistory.emptyHint" })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-ui-xs">
            <thead className="sticky top-0 z-10 bg-background text-foreground-subtle">
              <tr className="border-b border-border">
                <th className="w-6 px-2 py-1.5" />
                <th className="px-2 py-1.5 text-left font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.time" })}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.protocol" })}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.scope" })}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.host" })}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.port" })}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {intl.formatMessage({ id: "networkHistory.column.process" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const isExpanded = expanded === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : entry.id)}
                      className={cn(
                        "cursor-pointer border-b border-border/60 transition-colors hover:bg-foreground/5",
                        isExpanded && "bg-foreground/5",
                        entry.state === "closed" && "opacity-55",
                      )}
                    >
                      <td className="px-2 py-1.5 align-middle">
                        <ChevronRightIcon
                          className={cn(
                            "size-3.5 text-foreground-subtle transition-transform",
                            isExpanded && "rotate-90",
                          )}
                          aria-hidden="true"
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-foreground-subtle">
                        {formatTime(locale, entry.startedAt)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                            protocolPillClass(entry.protocol),
                          )}
                        >
                          {entry.protocol}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
                            classBadgeClass(entry.classification),
                          )}
                        >
                          {intl.formatMessage({ id: classLabelId(entry.classification) })}
                        </span>
                      </td>
                      <td className="max-w-[16rem] px-2 py-1.5">
                        <span className="block truncate font-mono text-foreground">
                          {entry.remoteHost}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-foreground-subtle">
                        {entry.remotePort}
                      </td>
                      <td className="max-w-[10rem] px-2 py-1.5">
                        <span className="block truncate font-mono text-foreground-subtle">
                          {entry.process}
                        </span>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-b border-border bg-surface/40">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="mb-2 break-all font-mono text-ui-xs text-foreground">
                            {entry.protocol.toLowerCase()}://{entry.remoteHost}:{entry.remotePort}
                          </div>
                          <dl className="grid grid-cols-[minmax(7rem,0.3fr)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-ui-xs">
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.address" })}
                            </dt>
                            <dd className="break-all text-foreground">
                              {entry.remoteAddr}:{entry.remotePort}
                            </dd>
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.process" })}
                            </dt>
                            <dd className="text-foreground">
                              {entry.process} (pid {entry.pid})
                            </dd>
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.scope" })}
                            </dt>
                            <dd className="text-foreground">
                              {intl.formatMessage({ id: classLabelId(entry.classification) })}
                            </dd>
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.state" })}
                            </dt>
                            <dd className="text-foreground">
                              {intl.formatMessage({ id: `networkHistory.state.${entry.state}` })}
                            </dd>
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.firstSeen" })}
                            </dt>
                            <dd className="text-foreground">{formatTime(locale, entry.startedAt)}</dd>
                            <dt className="text-foreground-subtle">
                              {intl.formatMessage({ id: "networkHistory.detail.lastSeen" })}
                            </dt>
                            <dd className="text-foreground">
                              {formatTime(locale, entry.lastSeenAt)}
                            </dd>
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
