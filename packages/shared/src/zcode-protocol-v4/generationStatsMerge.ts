import type { GenerationStats } from "./rows.js";

/** 单次 provider 请求段落上报的 token 与完成时刻。 */
export interface GenerationSegment {
  finishedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

/** 该回复首个段落的时间锚点（请求发出时刻与首 token 时刻）。 */
export interface GenerationTimingAnchor {
  startedAt: number;
  firstTokenAt?: number;
}

function sumTokens(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * 把一个 provider 段落并入“整条回复”的生成统计。长回复被 output-token 上限截断续写时，
 * 同一 rowId 会收到多个 ModelComplete，各自只带本段 usage。整条口径：
 * - startedAt / firstTokenAt：锚定首段，续写不覆盖（否则 TTFT 会被清零）。
 * - finishedAt：推进到最后一段。
 * - inputTokens：取首段的 prompt 规模（与锚定的 TTFT 对应，用于预填充吞吐）。
 * - cachedInputTokens：同样取首段（与首段 inputTokens 对应，用于展示前缀缓存命中）。
 * - outputTokens / reasoningTokens：跨段累加。
 */
export function mergeAssistantGenerationStats(
  prev: GenerationStats | undefined,
  segment: GenerationSegment,
  anchor: GenerationTimingAnchor,
): GenerationStats {
  return {
    startedAt: prev?.startedAt ?? anchor.startedAt,
    firstTokenAt: prev?.firstTokenAt ?? anchor.firstTokenAt,
    finishedAt: segment.finishedAt,
    inputTokens: prev?.inputTokens ?? segment.inputTokens,
    cachedInputTokens: prev?.cachedInputTokens ?? segment.cachedInputTokens,
    outputTokens: sumTokens(prev?.outputTokens, segment.outputTokens),
    reasoningTokens: sumTokens(prev?.reasoningTokens, segment.reasoningTokens),
  };
}
