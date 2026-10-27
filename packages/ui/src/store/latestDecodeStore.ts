import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { latestFinalDecodeTokPerSec } from "@/v4/assistantGenerationSpeed.js";

/**
 * 「活动会话最近一条完成回复的解码速率（tok/s）」的展示缓存，按 sessionId 键控。
 *
 * 唯一写入方是承载该 session snapshot 的 SessionPane；唯一读取方是顶栏 Bug Hunting Mode 浮层。
 * 这是纯展示派生值，不是服务端事实，不参与广播同步。
 *
 * Bug 修复背景：浮层此前读 session-debug 的 round.tokensPerSecond
 * （= outputTokens /（durationMs − timeToFirstContentMs））。当响应被缓冲为末尾一次性到达时，
 * 首内容里程碑贴近请求结束，解码窗口塌缩到几毫秒，速率被放大成两万+ 的假值。
 * 改为复用会话内唯一真源 computeGenerationSpeed（以 runtime 实测 firstTokenAt 计窗），
 * 与对话里 "… decode" 的数字同源一致。
 */
interface LatestDecodeState {
  bySession: Record<string, number | null>;
  setDecodeTps(sessionId: string, tps: number | null): void;
  clearDecodeTps(sessionId: string): void;
}

export const useLatestDecodeStore = create<LatestDecodeState>((set) => ({
  bySession: {},
  setDecodeTps: (sessionId, tps) =>
    set((state) => {
      // 值未变化时返回原 state，避免订阅方无谓重渲染。
      if (state.bySession[sessionId] === tps) return state;
      return { bySession: { ...state.bySession, [sessionId]: tps } };
    }),
  clearDecodeTps: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.bySession)) return state;
      const next = { ...state.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));

/** 顶栏读取某 session 的最近解码速率；无 session 或无可靠值时为 null。 */
export function useLatestDecodeTps(sessionId: string | null): number | null {
  return useLatestDecodeStore((state) => (sessionId ? (state.bySession[sessionId] ?? null) : null));
}

/**
 * 发布活动会话最近一条完成回复的解码速率到 store。由 SessionPane 单点调用；
 * session 切换或卸载时清理对应条目，保证 store 不随会话数无界增长。
 */
export function usePublishLatestDecodeTps(
  sessionId: string | null,
  rows: readonly ConversationRow[] | undefined,
): void {
  const setDecodeTps = useLatestDecodeStore((state) => state.setDecodeTps);
  const clearDecodeTps = useLatestDecodeStore((state) => state.clearDecodeTps);
  // rows 仅在 window 变化时换引用，用 memo 避免无关重渲染时重复线性扫描。
  const tps = useMemo(
    () => (sessionId && rows ? latestFinalDecodeTokPerSec(rows) : null),
    [sessionId, rows],
  );
  useEffect(() => {
    if (sessionId) setDecodeTps(sessionId, tps);
  }, [sessionId, tps, setDecodeTps]);
  useEffect(() => {
    if (!sessionId) return;
    return () => clearDecodeTps(sessionId);
  }, [sessionId, clearDecodeTps]);
}
