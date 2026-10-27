/**
 * 会话中展示的生成速度统计：解码/预填充吞吐、首 token 时延（TTFT）与 token 计数。
 *
 * 纯函数，不做任何 I/O。桌面端（packages/ui）与 TUI（apps/zcode-cli）共用同一套计算，
 * 保证两处显示的数字、口径完全一致。最终（final）口径使用 provider 上报的精确
 * `outputTokens`；流式过程中的实时（live）估算在渲染层单独处理，不走这里。
 */

/** 计算生成速度所需的时间戳与 token 输入。时间戳为毫秒（epoch ms）。 */
export interface GenerationSpeedInput {
  /** 请求发出的时刻。 */
  sendTime: number;
  /** 收到首个 token（文本或思考 delta）的时刻；从未产出 token 时为 undefined。 */
  firstTokenAt?: number;
  /** 本次回复完成的时刻。 */
  finishedAt: number;
  /** provider 上报的输入（prompt）token 数。 */
  inputTokens?: number;
  /** provider 上报的输出 token 数。 */
  outputTokens?: number;
  /** provider 上报的推理/思考 token 数。 */
  reasoningTokens?: number;
  /** provider 上报的命中前缀缓存的 prompt token 数（usage.prompt_tokens_details.cached_tokens）。 */
  cachedInputTokens?: number;
}

/** 计算结果。任一字段无法可靠计算时省略（undefined），绝不返回 NaN/Infinity。 */
export interface GenerationSpeedStats {
  /** 首 token 时延（毫秒）。 */
  ttftMs?: number;
  /** 预填充吞吐：inputTokens / TTFT（tokens/秒）。 */
  prefillTokPerSec?: number;
  /** 解码吞吐：生成 token / 解码窗口（tokens/秒）。 */
  decodeTokPerSec?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** 命中前缀缓存的 prompt token 数；透传用于展示。 */
  cachedInputTokens?: number;
}

/** 仅在 token 数与时间窗都为正、且比值有限时返回吞吐，否则返回 undefined（不显示）。 */
function positiveRate(tokens: number, windowSeconds: number): number | undefined {
  if (!(tokens > 0) || !(windowSeconds > 0)) return undefined;
  const rate = tokens / windowSeconds;
  return Number.isFinite(rate) ? rate : undefined;
}

/** 吞吐 >= 该值用整数显示，低于则保留一位小数。 */
const WHOLE_NUMBER_TOK_PER_SEC_THRESHOLD = 10;
/** TTFT 低于该毫秒数用 ms 显示，否则用秒（一位小数）。 */
const TTFT_SUBSECOND_MS_THRESHOLD = 100;
const MS_PER_SECOND = 1000;

const enUsNumber = new Intl.NumberFormat("en-US");

/** 千分位整数，如 1240 -> "1,240"。 */
function formatCount(tokens: number): string {
  return enUsNumber.format(tokens);
}

/** 吞吐格式化：>=10 取整并千分位，<10 保留一位小数。附 " tok/s" 单位。 */
export function formatTokPerSec(rate: number): string {
  const value =
    rate >= WHOLE_NUMBER_TOK_PER_SEC_THRESHOLD
      ? enUsNumber.format(Math.round(rate))
      : rate.toFixed(1);
  return `${value} tok/s`;
}

/** 首 token 时延格式化：<100ms 用毫秒，否则用秒（一位小数）。 */
export function formatTtft(ms: number): string {
  if (ms < TTFT_SUBSECOND_MS_THRESHOLD) return `${Math.round(ms)}ms`;
  return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
}

/** 实时估算用：流式阶段无逐块 token 数，按约四字符一 token 粗估。 */
const CHARS_PER_TOKEN_ESTIMATE = 4;
/** 实时窗口低于此毫秒数不显示速率，避免起步阶段数字剧烈抖动。 */
const MIN_LIVE_WINDOW_MS = 200;

/** 由已流出的字符数粗估 token 数（仅用于实时读数，绝不落盘）。 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.round(Math.max(0, charCount) / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * 实时解码速率的显示串，带 `~` 前缀以示估算；采样窗口过小或结果非正时返回 undefined。
 * 流式结束后应改用 computeGenerationSpeed 的精确值。
 */
export function formatLiveDecodeEstimate(
  charsStreamed: number,
  elapsedMs: number,
): string | undefined {
  if (elapsedMs < MIN_LIVE_WINDOW_MS) return undefined;
  const rate = estimateTokensFromChars(charsStreamed) / (elapsedMs / MS_PER_SECOND);
  if (!(rate > 0) || !Number.isFinite(rate)) return undefined;
  return `~${formatTokPerSec(rate)}`;
}

/** 渲染用的单项：语义 key + 已格式化字符串。词条/字形/布局由各端自行决定。 */
export interface GenerationSpeedPart {
  key: "input" | "output" | "decode" | "prefill" | "ttft";
  value: string;
}

/**
 * 单项的字形/词条串，桌面端与 TUI 共用以保证措辞一致：
 * input `↑值`、output `↓值`、decode `值 decode`、prefill `值 prefill`、ttft `TTFT 值`。
 */
export function generationSpeedPartLabel(part: GenerationSpeedPart): string {
  switch (part.key) {
    case "input":
      return `↑${part.value}`;
    case "output":
      return `↓${part.value}`;
    case "decode":
      return `${part.value} decode`;
    case "prefill":
      return `${part.value} prefill`;
    case "ttft":
      return `TTFT ${part.value}`;
  }
}

/**
 * 把统计结果转成有序、已格式化的渲染单项；无法显示的字段（undefined、0 token）直接省略。
 * 桌面端与 TUI 共用，保证数字口径一致。
 */
export function formatGenerationSpeedParts(stats: GenerationSpeedStats): GenerationSpeedPart[] {
  const parts: GenerationSpeedPart[] = [];

  if (stats.inputTokens !== undefined && stats.inputTokens > 0) {
    // 命中前缀缓存的 prompt token：以 "↑总量 (命中 cached)" 展示，夹到 [0, 总量]，仅在 >0 时附括号。
    const cached = Math.min(stats.inputTokens, Math.max(0, stats.cachedInputTokens ?? 0));
    const value =
      cached > 0
        ? `${formatCount(stats.inputTokens)} (${formatCount(cached)} cached)`
        : formatCount(stats.inputTokens);
    parts.push({ key: "input", value });
  }

  if (stats.outputTokens !== undefined && stats.outputTokens > 0) {
    const reasoning = stats.reasoningTokens ?? 0;
    // outputTokens 含思考 token：↓ 显示可见回答 = 总输出 - 思考，(+N think) 再列思考，二者之和即总输出；
    // 避免此前 "↓总量 (+思考)" 把思考重复计入、读起来像「总量 + 思考」。
    const visibleOutput = Math.max(0, stats.outputTokens - reasoning);
    const value =
      reasoning > 0
        ? `${formatCount(visibleOutput)} (+${formatCount(reasoning)} think)`
        : formatCount(stats.outputTokens);
    parts.push({ key: "output", value });
  }

  if (stats.decodeTokPerSec !== undefined) {
    parts.push({ key: "decode", value: formatTokPerSec(stats.decodeTokPerSec) });
  }

  if (stats.prefillTokPerSec !== undefined) {
    parts.push({ key: "prefill", value: formatTokPerSec(stats.prefillTokPerSec) });
  }

  if (stats.ttftMs !== undefined && stats.ttftMs >= 0) {
    parts.push({ key: "ttft", value: formatTtft(stats.ttftMs) });
  }

  return parts;
}

export function computeGenerationSpeed(input: GenerationSpeedInput): GenerationSpeedStats {
  const { sendTime, firstTokenAt, finishedAt, inputTokens, outputTokens, reasoningTokens, cachedInputTokens } =
    input;

  // TTFT 可能为 0 或（时钟异常时）为负：如实上报，但只有 > 0 时才用于预填充吞吐。
  const ttftMs = firstTokenAt === undefined ? undefined : firstTokenAt - sendTime;
  const decodeWindowSeconds =
    firstTokenAt === undefined ? undefined : (finishedAt - firstTokenAt) / 1000;
  // outputTokens 已包含思考 token（服务端 completion_tokens 口径，实测 totalTokens = input + output），
  // 解码窗口内生成的 token 总数即 outputTokens。不能再加 reasoningTokens，否则思考被重复计数、decode 虚高。
  const generatedTokens = outputTokens ?? 0;

  return {
    ttftMs,
    prefillTokPerSec:
      ttftMs === undefined || inputTokens === undefined
        ? undefined
        : positiveRate(inputTokens, ttftMs / 1000),
    decodeTokPerSec:
      decodeWindowSeconds === undefined
        ? undefined
        : positiveRate(generatedTokens, decodeWindowSeconds),
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
  };
}
