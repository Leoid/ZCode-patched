# Feature Spec: Generation Speed Stats in the Conversation

Status: draft for review
Owner: (local fork)
Surfaces: Desktop (Electron renderer) + TUI
Date: 2026-10-04

## 1. Goal

Show per-reply model throughput directly in the conversation, so a user running a
local model (e.g. a self-hosted GLM endpoint) can see how fast it is prefilling and
decoding without leaving the app or reading server logs.

For each assistant reply, display:

- **Decode tok/s** — output generation speed
- **Prefill tok/s** — prompt ingestion speed
- **TTFT** — time to first token
- **Token counts** — input / output (and reasoning, when present)

Behavior: a **live** estimate updates while the reply streams, then freezes to the
**final exact** numbers when the reply completes.

## 2. Non-goals

- No new model request, no change to request params, no server dependency beyond the
  prompt-token count the provider already returns in `usage`.
- No DB/persistence schema change.
- No aggregate "whole turn" rollup in v1 (a turn with tool calls has several replies;
  each reply gets its own line). Revisit later if wanted.

## 2a. Approach decision (2026-10-04)

Investigation (see §4) showed the assistant reply row carries **no usage and no
timing** at render time, and the per-request usage event has no reply identity. The
runtime computes every value we need but only writes it to its SQLite store.

Chosen approach: **carry the already-computed values onto the row** via a small,
**additive, back-compatible** change to the protocol-v4 assistant-row schema. All new
fields are optional; older rows without them simply render no stat line. This is the
only approach that yields the full feature (exact decode + prefill + TTFT + counts, on
both surfaces, live + final). Rejected: live-estimate-only (too little), and reusing
the per-round `SessionDebugSnapshot` (keyed per round not per reply; no prefill/TTFT).

## 3. Metrics and formulas

All inputs already exist (see §4). Durations are milliseconds; speeds are tokens/sec.

```
decodeTokPerSec  = outputTokens / ((finishedAt   - firstTokenAt) / 1000)
prefillTokPerSec = inputTokens  / ((firstTokenAt  - sendTime)     / 1000)
ttftMs           = firstTokenAt - sendTime
```

- **Decode (final)** uses exact `usage.outputTokens`.
- **Decode (live)** uses an *estimate* of tokens produced so far, because the stream
  carries no per-chunk token count (see §5). Rendered with a `~` prefix.
- **Prefill** depends on the provider reporting `inputTokens` in `usage`. The user's
  vLLM/TensorFold endpoint does (via `stream_options.include_usage`). When
  `inputTokens` is absent, prefill is omitted rather than shown as 0.

## 4. Data sources (verified in current checkout)

Runtime already computes and records these per model request:
`apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts`
- `firstTokenAt` (from first `ModelStreaming` text/reasoning delta)
- `startedAt`, `completedAt`, `durationMs`, `timeToFirstTokenMs`
- `inputTokens`, `outputTokens`, `reasoningTokens` (from `result.usage`)

UI already holds per-message telemetry:
`packages/ui/src/lib/messageTelemetry.ts`
- `firstTokenAt: number | null`
- `usage: ZCodeUsage | null` (`inputTokens`, `outputTokens`, `reasoningTokens`, …)
- `sendTime`, `waitingMs`, finish time

`ZCodeUsage`: `packages/shared/src/zcode-task-types-core.ts`.

### Timing is captured client-side (verified 2026-10-04)

The per-reply completion event `ModelCompletePayload`
(`apps/zcode-cli/packages/contracts/src/events/session.events.ts:765`) carries
`usage` but **no timing** — the runtime computes `firstTokenAt`/`durationMs` in
`usage-observability.ts` only to write the SQLite usage store; it is not in the event.

Timing is therefore derived on the client from `SessionEvent.timestamp` (every event
has one), which is exactly what the runtime does server-side:

- `startedAt`  = timestamp of `ModelRequest` (or the user's send time).
- `firstTokenAt` = timestamp of the first `ModelStreaming` delta
  (`kind: text_delta | reasoning_delta`) for that `assistantMessageId`.
- `finishedAt` = timestamp of `ModelComplete` / the `finish` streaming event.
- `usage` = `ModelComplete` payload.

This keeps the feature display-only (no protocol/DB change). Desktop already captures
`firstTokenAt` client-side for analytics (`messageTelemetry.ts`); the TUI will capture
the same from event timestamps into its `Message` model (local UI state only).

## 5. Live vs final (the one real constraint)

`ModelStreamingPayload` (`apps/zcode-cli/packages/contracts/src/events/session.events.ts`)
is `{ delta: string; kind?: ModelStreamingKind }` — **no incremental token count**.

Therefore:
- **Live** decode = `estimateTokens(streamedTextSoFar) / ((now - firstTokenAt)/1000)`,
  refreshed on a timer (~250 ms) while streaming. Marked approximate (`~`).
- **Final** decode = exact `usage.outputTokens / ((finishedAt - firstTokenAt)/1000)`.

`estimateTokens` v1 = a simple, documented heuristic (chars/4 for text; count
reasoning deltas separately). If the repo already exposes a tokenizer used for context
accounting, prefer it; otherwise the heuristic is clearly labeled as an estimate and is
only used for the transient live readout, never persisted.

## 6. Shared computation (single source of truth)

New pure module: `packages/shared/src/generationSpeed.ts`
- `computeGenerationSpeed(input): GenerationSpeedStats` — final, exact math.
- `formatGenerationSpeed(stats, opts): string` — compact formatter used by both
  surfaces so numbers/units/rounding are identical.
- Rounding: speeds to whole tok/s at ≥10, one decimal below 10; TTFT in seconds with
  one decimal (`0.4s`), or `ms` under 100 ms; token counts with thousands separators.
- Guards: return `undefined`/omit a field when its inputs are missing, non-finite, or
  the denominator is ≤ 0 (e.g. `firstTokenAt === finishedAt`, cancelled before first
  token). Never render `Infinity`, `NaN`, or divide-by-zero.

Unit tests colocated: `packages/shared/src/generationSpeed.test.ts`.

## 7. Rendering

Both surfaces render one compact, muted line under each assistant reply.

Proposed format (final):
```
↑ 1,240 · ↓ 340 (+58 think) · 42 tok/s decode · 850 tok/s prefill · TTFT 0.4s
```
Proposed format (live, while streaming):
```
↓ ~210 · ~44 tok/s · 3.1s
```

### Desktop
- Site: `packages/ui/src/v4/ConversationRowView.tsx` (assistant reply row) /
  `ConversationTurnGroup.tsx`.
- A small metadata footer. Typography MUST use `text-ui-xs` / `text-ui-caption` and
  muted foreground per `DESIGN.md` (no `text-xs`, no arbitrary px).
- Live value driven by a timer hook (same pattern as
  `useRunningBackgroundTaskElapsedClock`), reading the existing streamed-text buffer.
- On reply finish, swap to final stats from `usage` + `firstTokenAt`.

### TUI
- Site: `apps/zcode-cli/packages/tui/src/app-model-streaming.ts` (finish handler) +
  transcript components (`app-transcript-components.tsx`).
- A dim stats line appended to the assistant message; live line updates during
  streaming, frozen on `finish`.
- Must degrade when the terminal lacks color/Unicode (capability detection, ASCII
  fallback: `v/^` instead of arrows is NOT allowed per repo rule — use words:
  `in/out`, `decode`, `prefill`, `ttft`).

## 8. Edge cases

- No `firstTokenAt` (request failed/cancelled before any token): show nothing, or just
  token counts if usage exists.
- `outputTokens` present but `firstTokenAt` missing: omit decode.
- Missing `inputTokens`: omit prefill.
- Reasoning tokens: fold into output for decode speed? No — decode uses total generated
  tokens actually produced over the decode window. v1: decode denominator = output
  window; numerator = `outputTokens + reasoningTokens` if the provider counts reasoning
  separately from output. Documented and unit-tested either way.
- Cached prompt (`cacheReadTokens` > 0): prefill speed still uses reported `inputTokens`;
  note in tooltip (desktop) that cached tokens inflate apparent prefill speed.
- Very fast replies (sub-100 ms windows): guard against divide-by-zero; show `ms`.

## 9. Settings / visibility

- v1: always on. A toggle (`Show generation speed`) can be added to settings later; if
  added, it belongs in session/app settings, not an env var (per CLI AGENTS.md).

## 10. Test plan

- `generationSpeed.test.ts`: formulas, rounding, all §8 guards, formatter output.
- Desktop: component test that a finished assistant reply renders the final line and a
  streaming reply renders the live (`~`) line.
- TUI: transcript snapshot for live + final; ASCII-fallback rendering.
- Manual: run `mise run dev` against a copy of real `~/.zcode` data, exercise the local
  GLM endpoint, confirm numbers are sane vs server-side throughput.

## 11. Validation gates (repo-mandated)

- `pnpm typecheck` and `pnpm lint` from repo root.
- `pnpm --dir apps/zcode-cli typecheck` and `pnpm --dir apps/zcode-cli lint` for CLI.
- Relevant package tests for `shared`, `ui`, and `tui`.

## 12. Open decisions for review

1. Format/wording of the stat line (arrows vs words; order of fields).
2. Granularity: per-reply (recommended) vs per-turn rollup.
3. Reasoning-token handling in the decode numerator (§8).
4. Always-on vs behind a settings toggle in v1.

## 13. Top-bar "Bug Hunting Mode" decode readout

The desktop top overlay (`DesktopTopOverlay`) shows the latest reply's decode rate next to
the decorative overlay when "Bug Hunting Mode" is on. This readout **must share the single
source of truth** (`computeGenerationSpeed`, §4) with the in-conversation line, so the two
numbers always agree.

- **Source:** `latestFinalDecodeTokPerSec(rows)` scans the active session's row window for the
  most recent completed `assistantText` row with `generationStats` and returns its
  `decodeTokPerSec` (or `null` when unreliable → the overlay shows `--`).
- **Transport:** the active `SessionPane` (which owns that session's projection snapshot)
  publishes the value into `useLatestDecodeStore`, keyed by `sessionId`; the overlay, a sibling
  outside the conversation provider, reads it by `activeTaskId`. Single writer, single reader,
  cleared on session change/unmount.

### Bug fixed (2026-10-27): overlay showed `21360 tok/s decode`

The overlay previously read `round.tokensPerSecond` from `session-debug`, computed as
`outputTokens / (durationMs − timeToFirstContentMs)`. For **buffered / non-incremental**
responses the first-content milestone lands right at the request's end, so that decode window
collapses to a few milliseconds while `outputTokens` still counts the whole reply — inflating
the rate into the tens of thousands. `calculateOutputTps` only rejected windows `≤ 0`, so the
garbage value passed through. Fixed by sourcing the overlay from `computeGenerationSpeed`
(which measures the window from the runtime-observed `firstTokenAt`) instead. The
`session-debug` metric itself is unchanged; the Developer Tools pane still surfaces it as a raw
diagnostic.
