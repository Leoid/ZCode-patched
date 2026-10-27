import assert from "node:assert/strict";
import test from "node:test";
import { describeAssistantGenerationSpeed } from "../src/v4/assistantGenerationSpeed.js";

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
