import {
  computeGenerationSpeed,
  formatGenerationSpeedParts,
  generationSpeedPartLabel,
} from "@zcode/shared";
import {
  mergeAssistantGenerationStats,
  type GenerationSegment,
  type GenerationStats,
  type GenerationTimingAnchor,
} from "@zcode/shared/zcode-protocol-v4";
import type React from "react";
import type { Message } from "./app-model.js";
import { asRecord, numberField } from "./state.js";

/** 把一条回复的 GenerationStats 渲染成终端里的速度行；无可显示内容时返回 undefined。 */
export function tuiGenerationStatsLine(stats: GenerationStats): string | undefined {
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
  return parts.map(generationSpeedPartLabel).join(" · ");
}

// ModelComplete 现在携带 startedAt/firstTokenAt/finishedAt；把本段 timing+usage 并入
// 最后一条 agent 消息的生成速度统计（续写跨段累加）。旧事件无 timing 时跳过。
export function attachGenerationStatsFromModelComplete(
  payload: Record<string, unknown>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): void {
  const startedAt = numberField(payload, "startedAt");
  const finishedAt = numberField(payload, "finishedAt");
  if (startedAt === undefined && finishedAt === undefined) return;
  const usage = asRecord(payload.usage);
  const resolvedFinishedAt = finishedAt ?? Date.now();
  setMessages((current) =>
    attachGenerationStatsToLastAgent(
      current,
      {
        finishedAt: resolvedFinishedAt,
        inputTokens: numberField(usage, "inputTokens"),
        outputTokens: numberField(usage, "outputTokens"),
        reasoningTokens: numberField(usage, "reasoningTokens"),
        cachedInputTokens: numberField(usage, "cacheReadTokens"),
      },
      {
        startedAt: startedAt ?? resolvedFinishedAt,
        firstTokenAt: numberField(payload, "firstTokenAt"),
      },
    ),
  );
}

/** 把本段 timing+usage 并入最后一条 agent 消息的 generationStats（续写跨段累加）。 */
export function attachGenerationStatsToLastAgent(
  messages: Message[],
  segment: GenerationSegment,
  anchor: GenerationTimingAnchor,
): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "agent") continue;
    const merged = mergeAssistantGenerationStats(message.generationStats, segment, anchor);
    const next = messages.slice();
    next[index] = { ...message, generationStats: merged };
    return next;
  }
  return messages;
}
