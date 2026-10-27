import assert from "node:assert/strict";
import test from "node:test";
import { mergeAssistantGenerationStats } from "../src/zcode-protocol-v4/generationStatsMerge.js";

test("mergeAssistantGenerationStats: first segment takes anchor timing + its tokens", () => {
  const stats = mergeAssistantGenerationStats(
    undefined,
    { finishedAt: 9000, inputTokens: 1200, outputTokens: 300, reasoningTokens: 40, cachedInputTokens: 1024 },
    { startedAt: 1000, firstTokenAt: 1500 },
  );
  assert.deepEqual(stats, {
    startedAt: 1000,
    firstTokenAt: 1500,
    finishedAt: 9000,
    inputTokens: 1200,
    cachedInputTokens: 1024,
    outputTokens: 300,
    reasoningTokens: 40,
  });
});

test("mergeAssistantGenerationStats: continuation anchors timing, advances finish, sums output", () => {
  const first = mergeAssistantGenerationStats(
    undefined,
    { finishedAt: 9000, inputTokens: 1200, outputTokens: 300, reasoningTokens: 40 },
    { startedAt: 1000, firstTokenAt: 1500 },
  );
  const merged = mergeAssistantGenerationStats(
    first,
    { finishedAt: 15_000, inputTokens: 1500, outputTokens: 120, reasoningTokens: 10 },
    { startedAt: 9500, firstTokenAt: 9800 }, // second segment's own timing — must be ignored
  );
  assert.equal(merged.startedAt, 1000); // anchored to first segment
  assert.equal(merged.firstTokenAt, 1500); // anchored to first segment
  assert.equal(merged.finishedAt, 15_000); // advanced to last segment
  assert.equal(merged.inputTokens, 1200); // first segment's prompt size
  assert.equal(merged.outputTokens, 420); // 300 + 120
  assert.equal(merged.reasoningTokens, 50); // 40 + 10
});

test("mergeAssistantGenerationStats: token-less segment leaves counts undefined", () => {
  const stats = mergeAssistantGenerationStats(
    undefined,
    { finishedAt: 5000 },
    { startedAt: 1000, firstTokenAt: 1200 },
  );
  assert.equal(stats.outputTokens, undefined);
  assert.equal(stats.inputTokens, undefined);
  assert.equal(stats.finishedAt, 5000);
});
