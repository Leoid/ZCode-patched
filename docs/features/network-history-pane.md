# Feature Spec: Network History Pane (outbound HTTP history)

Status: draft for review
Owner: (local fork)
Surfaces: Desktop (Electron renderer)
Date: 2026-10-26

## 1. Goal

Give the user a Burp-Suite-style **HTTP history** of every outbound request ZCode's
Host process makes — model API calls, conversation-share downloads, update checks,
telemetry — in a dedicated side-pane tab, so they can see *where the harness reaches
out* without an external proxy. (undici bypasses `HTTP_PROXY`, so an external proxy
can't see this traffic; we capture it in-process instead.)

Per request, show a live-updating table row: time, method (colored pill), status
(colored pill), host, path, response size, duration. Click a row to expand its
request/response headers.

## 2. Non-goals / anti-goals

- **No bodies.** Metadata + headers only; response bodies are streams and we never
  buffer them.
- **No persistence.** In-memory ring buffer of the last `NETWORK_HISTORY_LIMIT` (1000)
  entries per renderer; cleared on app restart (like Burp's default proxy history).
- **v1 is Host-process only.** WebFetch runs in the Agent CLI subprocess and is NOT
  captured yet — that's a deliberate fast-follow (see §6). An explicit non-goal that
  v1 pretends to cover agent egress.
- No credentials in the captured data: `Authorization`, `Cookie`, `x-api-key`, etc.
  are masked at the capture site before leaving the Host.

## 3. Approach

Capture at the lowest common choke point: a `node:diagnostics_channel` subscriber on
undici's `undici:request:{create,headers,trailers,error}` in the Host process. undici's
npm package and Node's built-in global `fetch` publish to the same channel names, so a
single subscriber covers every out-of-process HTTP call the Host makes, with no edits
to individual call sites.

Data flow (reuses the existing coarse-IPC telemetry pattern, cf. `hostNetworkTelemetry.ts`):

```
Host  diagnostics_channel → batch (1s / 500) → parentPort.postMessage(NetworkHistoryBatch)
  → Main  desktopHostProcess child.on("message") → win.webContents.send(PlatformChannels.NetworkHistoryBatch)
  → preload  window.zcode.onNetworkHistoryBatch  → IPlatformService.onNetworkHistoryBatch
  → renderer  networkHistoryStore (singleton subscription) → NetworkHistoryPane
```

The renderer subscription is a process-lifetime singleton so history survives
closing/reopening the pane. (Caveat: capture on the renderer begins the first time the
pane mounts; traffic before that isn't shown. From-launch capture would mean
subscribing at app root — deferred.)

## 4. Key files

- `packages/shared/src/network-history.ts` — `NetworkHistoryEntry` schema + limits.
- `packages/shared/src/validation.ts` — `hostNetworkHistoryBatchResponseSchema` in the host-response union.
- `packages/shared/src/channels.ts` — `HostResponseTypes.NetworkHistoryBatch`, `PlatformChannels.NetworkHistoryBatch`.
- `packages/shared/src/platform.ts` — `IPlatformService.onNetworkHistoryBatch`.
- `packages/desktop/src/host/hostNetworkHistory.ts` — the capture + batch flush.
- `packages/desktop/src/main/desktopHostProcess.ts` — forward batch to the originating window.
- `packages/desktop/src/preload/index.ts` + `packages/client/src/globals.d.ts` — bridge.
- `packages/ui/src/store/networkHistoryStore.ts` — ring buffer + singleton subscription.
- `packages/ui/src/NetworkHistoryPane.tsx` — the table UI.
- Side-pane wiring: `lib/workspaceSidePane.ts`, `app-shell/{sidePaneTabPresentation,SidePaneTabTrigger,AnimatedSidePanePanel,animatedSidePanePanelModel,types,WorkspaceShellLayout}`, `hooks/useAppPanels.ts`, `App.tsx`, locales.

## 5. Acceptance

- Opening the "Network" side-pane tab shows rows appearing live as the model streams.
- Each row's method/status pills are color-coded; click expands headers; `Authorization`
  shows masked.
- Filter box narrows by host/path/method/status; "Errors only" toggles 4xx/5xx/errors.
- `pnpm typecheck` and `pnpm lint` pass.

## 6. Fast-follow (v2)

Add an undici `diagnostics_channel` subscriber in the Agent CLI runtime
(`apps/zcode-cli/.../zcode-protocol-entrypoint.ts`), emit a `networkLog` notification
over the existing NDJSON sink, have the Host re-post it as `NetworkHistoryBatch`
(`source: "agent"`). That captures **WebFetch** (model-chosen URLs) and MCP HTTP — the
security-relevant egress v1 omits.
