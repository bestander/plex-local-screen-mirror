# Plex Playback Signal Prototype Design (A -> B)

## Objective

Determine whether Plex Local Screen Mirror can obtain a more precise remote playback clock than the current `/status/sessions` + interpolation approach, specifically for a LAN Android TV Plex app target.

This design covers a two-stage prototype:

- **A:** Deep-inspect existing Plex WebSocket payloads for richer timing signals.
- **B:** Probe direct player timeline polling feasibility on LAN and compare precision.

## Non-Goals

- Replacing the production sync engine behavior in this phase.
- Implementing automatic switching of timing sources in end-user sync.
- Supporting non-LAN or unknown remote player networks during prototype.

## Current Baseline

Current sync path (already implemented):

- Initial start position from `/status/sessions` `viewOffset`.
- Runtime state changes from WebSocket `PlaySessionStateNotification`.
- Drift correction every second, with interpolation between coarse session updates.
- Smooth speed correction + hard seek fallback.

Known limitation: `/status/sessions` offset granularity and freshness are limited, and current WebSocket consumption may ignore richer timing details.

## Prototype A: WebSocket Payload Deep Inspection

### Design

Add a probe mode that passively captures all WebSocket messages relevant to the selected `sessionKey` while leaving sync behavior unchanged.

For each captured record:

- `tLocalMs`: local wall-clock capture time.
- `source`: `"ws"`.
- `sessionKey`.
- `eventType`: inferred top-level notification type.
- `state` if present.
- Position-like fields if present (for example `viewOffset` and any timeline offsets).
- `rawSizeBytes`.
- `payload`: optional raw object for offline parsing (only in probe mode).

Records are appended to NDJSON:

- `logs/probes/probe-log.ndjson` (or equivalent user-data path in Electron).

### Why

This confirms whether we already receive timing fields that are fresher or richer than currently used, with minimal risk and no protocol assumptions.

## Prototype B: Direct Player Timeline Poll Feasibility

### Design

Add a second probe that attempts timeline polling against the active Plex player endpoint when on LAN.

- Poll cadence: 250-500 ms.
- Capture window: 2-3 minutes per run, plus longer mixed-behavior run (10-15 min).
- Normalize captured records to same schema as A:
  - `tLocalMs`, `source`, `sessionKey`, `state`, `positionMs`, plus endpoint status.

Collect in parallel:

- `source: "playerTimeline"` from direct player poll.
- `source: "ws"` from WebSocket.
- `source: "sessions"` from `/status/sessions`.

### Failure Handling

If player polling is not reachable or authorized:

- Mark probe result as unsupported with explicit reason (`network`, `auth`, `missing_fields`, `other`).
- Continue collecting WS + sessions without interrupting sync.

### Why

This directly answers whether Android TV on LAN can provide a lower-latency, lower-jitter playback clock source in practice.

## Data Flow

1. User enables probe mode for a selected session.
2. Sync runs normally.
3. Probe collectors ingest signals from WS, sessions, and optionally player timeline.
4. All samples are normalized and written to NDJSON.
5. Offline analyzer computes freshness/jitter/drift metrics and emits recommendation.

## Metrics and Decision Criteria

For each source compute:

- **Sample age/freshness:** estimated delay between observed `positionMs` and local capture time model.
- **Jitter:** variance in consecutive `positionMs` deltas.
- **Stability across events:** correctness through pause/resume/seek/buffering.
- **Recovery time:** time to restabilize after seek.

Decision:

- **Promote direct player timeline candidate** if it is stable and materially better than WS/sessions.
- **Keep WS-primary with sessions fallback** if direct polling is unreliable or not materially better.

## Testing Plan

Run at least one 10-15 minute scripted scenario:

1. 3-4 min steady playback.
2. pause/resume.
3. manual seek forward and backward.
4. short buffering event (if naturally triggered).
5. return to steady playback.

Verify:

- Probe logging does not break sync behavior.
- Record schema remains parseable and complete.
- Unsupported player poll path degrades gracefully.

## Risks and Mitigations

- **High log volume:** bound capture windows, optionally sample raw payload storage.
- **Protocol variance across Plex clients:** keep parser defensive and schema-extensible.
- **False precision assumptions:** rely on measured metrics before integrating into sync loop.

## Implementation Scope Boundaries

This prototype phase should produce:

- Probe instrumentation.
- Capture logs from real Android TV session(s).
- A short findings summary and recommendation.

This phase should not yet produce:

- Automatic runtime source arbitration in production sync.
- Permanent UI controls beyond minimal probe toggle.

## Recommendation

Proceed with **A first, then B**, then decide integration path based on measured results.

Given LAN Android TV constraints, this sequence is the fastest way to de-risk feasibility with minimal regression risk.
