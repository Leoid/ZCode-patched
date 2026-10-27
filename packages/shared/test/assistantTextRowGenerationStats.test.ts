import assert from "node:assert/strict";
import test from "node:test";
import { assistantTextRowSchema } from "../src/zcode-protocol-v4/rows.js";

const baseRow = {
  rowId: 1,
  turnId: "t1",
  createdAt: 1000,
  createdAtSeq: 1,
  kind: "assistantText" as const,
  text: "hi",
  state: "complete" as const,
};

test("assistantTextRowSchema: parses a row without generationStats (back-compat)", () => {
  const parsed = assistantTextRowSchema.parse(baseRow);
  assert.equal(parsed.kind, "assistantText");
  assert.equal(parsed.generationStats, undefined);
});

test("assistantTextRowSchema: keeps generationStats when present", () => {
  const parsed = assistantTextRowSchema.parse({
    ...baseRow,
    generationStats: {
      startedAt: 1000,
      firstTokenAt: 1400,
      finishedAt: 9400,
      inputTokens: 1200,
      outputTokens: 340,
      reasoningTokens: 58,
    },
  });
  assert.equal(parsed.generationStats?.startedAt, 1000);
  assert.equal(parsed.generationStats?.firstTokenAt, 1400);
  assert.equal(parsed.generationStats?.finishedAt, 9400);
  assert.equal(parsed.generationStats?.outputTokens, 340);
  assert.equal(parsed.generationStats?.reasoningTokens, 58);
});

test("assistantTextRowSchema: generationStats timing-only (no token counts) is valid", () => {
  const parsed = assistantTextRowSchema.parse({
    ...baseRow,
    generationStats: { startedAt: 1000, finishedAt: 5000 },
  });
  assert.equal(parsed.generationStats?.finishedAt, 5000);
  assert.equal(parsed.generationStats?.outputTokens, undefined);
});
