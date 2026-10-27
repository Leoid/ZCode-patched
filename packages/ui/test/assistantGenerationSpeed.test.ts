import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import {
  describeAssistantGenerationSpeed,
  latestFinalDecodeTokPerSec,
} from "../src/v4/assistantGenerationSpeed.js";

// 测试只关心扫描逻辑读取的 kind/state/generationStats 字段，用结构化最小行并断言为 ConversationRow。
function asRows(...rows: Array<Record<string, unknown>>): ConversationRow[] {
  return rows as unknown as ConversationRow[];
}

const completeRow = {
  state: "complete" as const,
  text: "hello",
  createdAt: 1000,
  generationStats: {
    startedAt: 0,
    firstTokenAt: 400, // ttft 400ms
    finishedAt: 8400, // decode window 8s
    inputTokens: 1240, // prefill 1240/0.4 = 3100 tok/s
    outputTokens: 320, // decode 320/8 = 40 tok/s
    reasoningTokens: 0,
  },
};

test("describeAssistantGenerationSpeed: final parts for a completed reply with stats", () => {
  const display = describeAssistantGenerationSpeed(completeRow, 9000);
  assert.equal(display?.kind, "final");
  if (display?.kind !== "final") return;
  const byKey = Object.fromEntries(display.parts.map((p) => [p.key, p.value]));
  assert.equal(byKey.decode, "40 tok/s");
  assert.equal(byKey.prefill, "3,100 tok/s");
  assert.equal(byKey.ttft, "0.4s");
});

test("describeAssistantGenerationSpeed: nothing for a completed reply without stats", () => {
  assert.equal(
    describeAssistantGenerationSpeed({ ...completeRow, generationStats: undefined }, 9000),
    undefined,
  );
});

test("describeAssistantGenerationSpeed: live estimate while streaming", () => {
  const display = describeAssistantGenerationSpeed(
    { state: "streaming", text: "x".repeat(800), createdAt: 1000, generationStats: undefined },
    5000, // elapsed 4s; ~200 tokens / 4s = ~50 tok/s
  );
  assert.equal(display?.kind, "live");
  if (display?.kind !== "live") return;
  assert.equal(display.outputApprox, "~200");
  assert.equal(display.decode, "~50 tok/s");
  assert.equal(display.elapsed, "4.0s");
});

test("describeAssistantGenerationSpeed: live omits rate until the window opens", () => {
  const display = describeAssistantGenerationSpeed(
    { state: "streaming", text: "x".repeat(800), createdAt: 1000, generationStats: undefined },
    1100, // elapsed 100ms < sampling window
  );
  assert.equal(display?.kind, "live");
  if (display?.kind !== "live") return;
  assert.equal(display.decode, undefined);
  assert.equal(display.elapsed, "0.1s");
});

test("describeAssistantGenerationSpeed: nothing while streaming with no text yet", () => {
  assert.equal(
    describeAssistantGenerationSpeed(
      { state: "streaming", text: "", createdAt: 1000, generationStats: undefined },
      5000,
    ),
    undefined,
  );
});

test("latestFinalDecodeTokPerSec: returns the latest completed reply's decode rate", () => {
  const rows = asRows(
    // 较早的一条：320 / 8s = 40 tok/s
    {
      kind: "assistantText",
      state: "complete",
      generationStats: { startedAt: 0, firstTokenAt: 400, finishedAt: 8400, outputTokens: 320 },
    },
    { kind: "userInput" },
    // 最近的一条：1000 / 10s = 100 tok/s
    {
      kind: "assistantText",
      state: "complete",
      generationStats: { startedAt: 0, firstTokenAt: 500, finishedAt: 10500, outputTokens: 1000 },
    },
  );
  assert.equal(latestFinalDecodeTokPerSec(rows), 100);
});

test("latestFinalDecodeTokPerSec: null when the decode window collapses (regression for 21360)", () => {
  // 首 token 贴着请求结束 → 解码窗口为 0。旧 session-debug 口径会把它放大成两万+ 的假值；
  // 走唯一真源后，窗口非正即不可测，应返回 null（浮层显示 "--"）。
  const rows = asRows({
    kind: "assistantText",
    state: "complete",
    generationStats: { startedAt: 0, firstTokenAt: 2000, finishedAt: 2000, outputTokens: 182 },
  });
  assert.equal(latestFinalDecodeTokPerSec(rows), null);
});

test("latestFinalDecodeTokPerSec: skips streaming and non-assistant rows", () => {
  const rows = asRows(
    {
      kind: "assistantText",
      state: "complete",
      generationStats: { startedAt: 0, firstTokenAt: 400, finishedAt: 8400, outputTokens: 320 },
    },
    { kind: "assistantText", state: "streaming", text: "partial" },
    { kind: "toolCall" },
  );
  assert.equal(latestFinalDecodeTokPerSec(rows), 40);
});

test("latestFinalDecodeTokPerSec: null for empty or no matching rows", () => {
  assert.equal(latestFinalDecodeTokPerSec(asRows()), null);
  assert.equal(latestFinalDecodeTokPerSec(asRows({ kind: "userInput" })), null);
});
