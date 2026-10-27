import {
  computeGenerationSpeed,
  estimateTokensFromChars,
  formatGenerationSpeedParts,
  formatLiveDecodeEstimate,
  type GenerationSpeedPart,
} from "@zcode/shared";
import type { AssistantTextRow, ConversationRow } from "@zcode/shared/zcode-protocol-v4";

const MS_PER_SECOND = 1000;

/** 流式阶段的实时读数（估算，带 `~`）。 */
export interface GenerationSpeedLiveDisplay {
  kind: "live";
  /** 估算的已产出 token 数，如 "~200"。 */
  outputApprox?: string;
  /** 估算解码速率，如 "~44 tok/s"；采样窗口过小时省略。 */
  decode?: string;
  /** 已流式时长，如 "3.1s"。 */
  elapsed: string;
}

/** 完成后的精确读数。 */
export interface GenerationSpeedFinalDisplay {
  kind: "final";
  parts: GenerationSpeedPart[];
}

export type GenerationSpeedDisplay =
  | GenerationSpeedLiveDisplay
  | GenerationSpeedFinalDisplay
  | undefined;

type GenerationSpeedRow = Pick<
  AssistantTextRow,
  "state" | "text" | "createdAt" | "generationStats"
>;

/**
 * 决定某条 assistant 回复该显示的生成速度读数：流式中给实时估算，完成后给精确值，
 * 两者都无可显示内容时返回 undefined。纯函数，便于单测；字形/样式交给渲染组件。
 */
export function describeAssistantGenerationSpeed(
  row: GenerationSpeedRow,
  now: number,
): GenerationSpeedDisplay {
  if (row.state === "streaming") {
    if (row.text.length === 0) return undefined;
    const elapsedMs = Math.max(0, now - row.createdAt);
    const approxTokens = estimateTokensFromChars(row.text.length);
    return {
      kind: "live",
      ...(approxTokens > 0 ? { outputApprox: `~${approxTokens}` } : {}),
      decode: formatLiveDecodeEstimate(row.text.length, elapsedMs),
      elapsed: `${(elapsedMs / MS_PER_SECOND).toFixed(1)}s`,
    };
  }
  if (row.state === "complete" && row.generationStats) {
    const stats = row.generationStats;
    const parts = formatGenerationSpeedParts(
      computeGenerationSpeed({
        sendTime: stats.startedAt,
        firstTokenAt: stats.firstTokenAt,
        finishedAt: stats.finishedAt,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        reasoningTokens: stats.reasoningTokens,
        cachedInputTokens: stats.cachedInputTokens,
      }),
    );
    if (parts.length === 0) return undefined;
    return { kind: "final", parts };
  }
  return undefined;
}

/**
 * 倒序扫描会话 window，返回最近一条「已完成且带 generationStats」的 assistant 回复的解码速率
 * （tok/s）；无可靠值（缺 firstTokenAt、窗口非正或 0 token）时返回 null。
 *
 * 用会话内唯一真源 computeGenerationSpeed 计算，保证与对话内 "… decode" 的数字同源一致。
 * 供顶栏 Bug Hunting Mode 浮层展示，替代 session-debug 中会被缓冲响应放大成假值的 tokensPerSecond。
 */
export function latestFinalDecodeTokPerSec(rows: readonly ConversationRow[]): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind !== "assistantText" || row.state !== "complete" || !row.generationStats) {
      continue;
    }
    const stats = row.generationStats;
    const decode = computeGenerationSpeed({
      sendTime: stats.startedAt,
      firstTokenAt: stats.firstTokenAt,
      finishedAt: stats.finishedAt,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      reasoningTokens: stats.reasoningTokens,
      cachedInputTokens: stats.cachedInputTokens,
    }).decodeTokPerSec;
    return typeof decode === "number" && Number.isFinite(decode) ? decode : null;
  }
  return null;
}
