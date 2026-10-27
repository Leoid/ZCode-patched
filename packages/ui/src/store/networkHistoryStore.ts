/**
 * Network 面板状态：汇总 Host 回传的出站请求抓取条目（Burp HTTP history 风格）。
 *
 * 订阅在全进程只建立一次并常驻，关闭/重开面板不丢历史；渲染端保留最近
 * NETWORK_HISTORY_LIMIT 条，超出丢弃最旧的。pending 与后续 complete/error 用同 id 覆盖合并。
 */
import { create } from "zustand";
import type { IPlatformService, NetworkHistoryEntry } from "@zcode/shared";
import { NETWORK_HISTORY_LIMIT } from "@zcode/shared";

interface NetworkHistoryState {
  entries: NetworkHistoryEntry[];
  applyBatch: (batch: NetworkHistoryEntry[]) => void;
  clear: () => void;
}

export const useNetworkHistoryStore = create<NetworkHistoryState>((set, get) => ({
  entries: [],
  applyBatch: (batch) => {
    if (batch.length === 0) return;
    const byId = new Map(get().entries.map((entry) => [entry.id, entry] as const));
    for (const entry of batch) {
      byId.set(entry.id, entry);
    }
    let merged = Array.from(byId.values());
    merged.sort((a, b) => a.startedAt - b.startedAt);
    if (merged.length > NETWORK_HISTORY_LIMIT) {
      merged = merged.slice(merged.length - NETWORK_HISTORY_LIMIT);
    }
    set({ entries: merged });
  },
  clear: () => set({ entries: [] }),
}));

let subscribed = false;

/** 全进程仅订阅一次并常驻；由 Network 面板首次挂载时触发。 */
export function ensureNetworkHistorySubscription(platform: IPlatformService): void {
  if (subscribed) return;
  subscribed = true;
  platform.onNetworkHistoryBatch((entries) => {
    useNetworkHistoryStore.getState().applyBatch(entries);
  });
}
