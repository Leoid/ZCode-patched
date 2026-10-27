import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGenerationSpeed,
  estimateTokensFromChars,
  formatGenerationSpeedParts,
  generationSpeedPartLabel,
  formatLiveDecodeEstimate,
  formatTokPerSec,
  formatTtft,
} from "../src/generationSpeed.js";

test("formatTokPerSec: whole numbers at >=10, one decimal below, thousands separated", () => {
  assert.equal(formatTokPerSec(40), "40 tok/s");
  assert.equal(formatTokPerSec(4.2), "4.2 tok/s");
  assert.equal(formatTokPerSec(3100), "3,100 tok/s");
});

test("formatTtft: milliseconds under 100ms, seconds (one decimal) otherwise", () => {
  assert.equal(formatTtft(80), "80ms");
  assert.equal(formatTtft(400), "0.4s");
  assert.equal(formatTtft(1200), "1.2s");
});

test("formatGenerationSpeedParts: ordered, formatted parts for a normal reply", () => {
  const parts = formatGenerationSpeedParts(
    computeGenerationSpeed({
      sendTime: 0,
      firstTokenAt: 400, // ttft 400ms
      finishedAt: 8400, // decode window 8s
      inputTokens: 1240, // prefill 1240 / 0.4s = 3100 tok/s
      outputTokens: 320, // decode 320 / 8s = 40 tok/s
      reasoningTokens: 0,
    }),
  );
  assert.deepEqual(
    parts.map((p) => p.key),
    ["input", "output", "decode", "prefill", "ttft"],
  );
  const byKey = Object.fromEntries(parts.map((p) => [p.key, p.value]));
  assert.equal(byKey.input, "1,240");
  assert.equal(byKey.output, "320");
  assert.equal(byKey.decode, "40 tok/s");
  assert.equal(byKey.prefill, "3,100 tok/s");
  assert.equal(byKey.ttft, "0.4s");
});

test("formatGenerationSpeedParts: input shows server-cached prompt tokens when present", () => {
  // 服务端前缀缓存命中数（usage.prompt_tokens_details.cached_tokens）以 "↑总量 (命中 cached)" 展示，
  // 让用户看到本次请求有多少 prompt 复用了缓存。cached=0 时不显示括号。
  const parts = formatGenerationSpeedParts(
    computeGenerationSpeed({
      sendTime: 0,
      firstTokenAt: 400,
      finishedAt: 8400,
      inputTokens: 51640,
      outputTokens: 320,
      reasoningTokens: 0,
      cachedInputTokens: 49152,
    }),
  );
  const input = parts.find((p) => p.key === "input");
  assert.equal(input?.value, "51,640 (49,152 cached)");
});

test("formatGenerationSpeedParts: output splits visible answer from think, summing to total", () => {
  // outputTokens 含思考；↓ 显示可见回答 = 总输出 - 思考，(+N think) 为思考，二者之和即总输出。
  // 340 含 58 思考 → 可见 282，显示 "282 (+58 think)"（282 + 58 = 340）。
  const parts = formatGenerationSpeedParts(
    computeGenerationSpeed({
      sendTime: 0,
      firstTokenAt: 1000,
      finishedAt: 9000,
      inputTokens: 100,
      outputTokens: 340,
      reasoningTokens: 58,
    }),
  );
  const output = parts.find((p) => p.key === "output");
  assert.equal(output?.value, "282 (+58 think)");
});

test("formatGenerationSpeedParts: omits parts whose value is unavailable", () => {
  const parts = formatGenerationSpeedParts(
    computeGenerationSpeed({
      sendTime: 0,
      firstTokenAt: undefined, // no token produced -> no speeds/ttft
      finishedAt: 5000,
      inputTokens: 100,
      outputTokens: 0,
    }),
  );
  const keys = parts.map((p) => p.key);
  assert.ok(!keys.includes("decode"));
  assert.ok(!keys.includes("prefill"));
  assert.ok(!keys.includes("ttft"));
  assert.ok(!keys.includes("output")); // 0 output tokens -> nothing to show
  assert.ok(keys.includes("input"));
});

test("generationSpeedPartLabel: glyphs and labels per part key", () => {
  assert.equal(generationSpeedPartLabel({ key: "input", value: "1,240" }), "↑1,240");
  assert.equal(
    generationSpeedPartLabel({ key: "output", value: "282 (+58 think)" }),
    "↓282 (+58 think)",
  );
  assert.equal(generationSpeedPartLabel({ key: "decode", value: "40 tok/s" }), "40 tok/s decode");
  assert.equal(
    generationSpeedPartLabel({ key: "prefill", value: "3,100 tok/s" }),
    "3,100 tok/s prefill",
  );
  assert.equal(generationSpeedPartLabel({ key: "ttft", value: "0.4s" }), "TTFT 0.4s");
});

test("estimateTokensFromChars: roughly four characters per token", () => {
  assert.equal(estimateTokensFromChars(400), 100);
  assert.equal(estimateTokensFromChars(0), 0);
});

test("formatLiveDecodeEstimate: tilde-prefixed rate once the window is wide enough", () => {
  // 800 chars -> ~200 tokens over 4s -> ~50 tok/s
  assert.equal(formatLiveDecodeEstimate(800, 4000), "~50 tok/s");
});

test("formatLiveDecodeEstimate: nothing until the sampling window opens", () => {
  assert.equal(formatLiveDecodeEstimate(50, 100), undefined);
});
