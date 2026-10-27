import assert from "node:assert/strict";
import test from "node:test";
import { computeGenerationSpeed } from "../src/generationSpeed.js";

test("computeGenerationSpeed: decode, prefill, and TTFT from a normal reply", () => {
  const stats = computeGenerationSpeed({
    sendTime: 1000,
    firstTokenAt: 2000, // ttft = 1000ms = 1s
    finishedAt: 10_000, // decode window = 8000ms = 8s
    inputTokens: 850,
    outputTokens: 320,
    reasoningTokens: 0,
  });
  assert.equal(stats.ttftMs, 1000);
  assert.equal(stats.prefillTokPerSec, 850); // 850 input / 1s
  assert.equal(stats.decodeTokPerSec, 40); // 320 output / 8s
  assert.equal(stats.inputTokens, 850);
  assert.equal(stats.outputTokens, 320);
});

test("computeGenerationSpeed: omits decode when the decode window is zero", () => {
  const stats = computeGenerationSpeed({
    sendTime: 0,
    firstTokenAt: 500,
    finishedAt: 500, // first token == finish -> window 0
    inputTokens: 10,
    outputTokens: 5,
  });
  assert.equal(stats.decodeTokPerSec, undefined);
});

test("computeGenerationSpeed: reports zero TTFT but omits prefill when TTFT is zero", () => {
  const stats = computeGenerationSpeed({
    sendTime: 1000,
    firstTokenAt: 1000, // ttft 0
    finishedAt: 5000,
    inputTokens: 100,
    outputTokens: 50,
  });
  assert.equal(stats.ttftMs, 0);
  assert.equal(stats.prefillTokPerSec, undefined);
});

test("computeGenerationSpeed: omits decode when no tokens were generated", () => {
  const stats = computeGenerationSpeed({
    sendTime: 0,
    firstTokenAt: 100,
    finishedAt: 2100,
    inputTokens: 10,
    outputTokens: 0,
    reasoningTokens: 0,
  });
  assert.equal(stats.decodeTokPerSec, undefined);
});

test("computeGenerationSpeed: outputTokens already includes reasoning; decode counts them once", () => {
  // 服务端 completion_tokens(=outputTokens) 已包含思考 token（实测 totalTokens = input + output，
  // reasoning 是 output 的子集）。解码吞吐按总生成量计 = outputTokens / 窗口，绝不再加 reasoningTokens，
  // 否则思考 token 被重复计数、decode 虚高。此处 320 已含 80 思考 → 320 / 8s = 40（不是 (320+80)/8=50）。
  const stats = computeGenerationSpeed({
    sendTime: 0,
    firstTokenAt: 1000,
    finishedAt: 9000, // decode window 8s
    inputTokens: 100,
    outputTokens: 320, // 含 80 思考
    reasoningTokens: 80,
  });
  assert.equal(stats.decodeTokPerSec, 40);
});

test("computeGenerationSpeed: no first token omits speeds but keeps token counts", () => {
  const stats = computeGenerationSpeed({
    sendTime: 1000,
    firstTokenAt: undefined,
    finishedAt: 5000,
    inputTokens: 1200,
    outputTokens: 0,
  });
  assert.equal(stats.ttftMs, undefined);
  assert.equal(stats.prefillTokPerSec, undefined);
  assert.equal(stats.decodeTokPerSec, undefined);
  assert.equal(stats.inputTokens, 1200);
});

test("computeGenerationSpeed: missing input tokens omits prefill", () => {
  const stats = computeGenerationSpeed({
    sendTime: 0,
    firstTokenAt: 500,
    finishedAt: 4500,
    outputTokens: 200,
  });
  assert.equal(stats.prefillTokPerSec, undefined);
  assert.notEqual(stats.decodeTokPerSec, undefined);
});
