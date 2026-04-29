# Playback Signal Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe probe pipeline that captures and compares playback-position signals from WebSocket events, `/status/sessions`, and (when possible) direct player timeline polling on LAN Android TV.

**Architecture:** Introduce a standalone probe recorder module and wire it into `sync` lifecycle so instrumentation is passive and does not alter sync decisions. Implement source-specific collectors (WS, sessions, player timeline) that write normalized NDJSON records, then add a small analysis script to compute freshness/jitter/recovery metrics for A->B go/no-go.

**Tech Stack:** Electron main process, Node.js modules in `src/`, Jest unit tests, NDJSON logging, npm scripts.

---

## File Structure

- Create: `src/probe.js` - probe lifecycle + NDJSON writer + normalized schema helpers.
- Create: `src/playerTimeline.js` - direct player timeline poller with LAN-safe timeout and failure classification.
- Create: `scripts/analyze-probe-log.js` - offline metrics calculator for probe logs.
- Modify: `src/sync.js` - emit probe records from WS + sessions paths and control probe lifecycle.
- Modify: `src/plex.js` - expose richer session player fields needed for player polling.
- Modify: `main.js` - pass probe options into `sync:start` and expose one-shot probe controls.
- Modify: `preload.js` - expose probe control IPC to renderer.
- Modify: `renderer/popover.js` - temporary probe start/stop trigger and status text.
- Modify: `renderer/popover.html` - minimal probe controls (toggle button + status label).
- Modify: `tests/sync.test.js` - verify passive WS/sessions capture and failure-safe behavior.
- Create: `tests/probe.test.js` - unit-test record normalization and write flow.
- Create: `tests/playerTimeline.test.js` - unit-test polling success + failure classification.
- Modify: `package.json` - add analysis npm script.

### Task 1: Add Probe Recorder Core

**Files:**
- Create: `src/probe.js`
- Test: `tests/probe.test.js`

- [ ] **Step 1: Write the failing tests for probe recorder behavior**

```js
// tests/probe.test.js
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const probe = require('../src/probe');

test('record writes one NDJSON line with normalized fields', async () => {
  const logPath = path.join(os.tmpdir(), `probe-${Date.now()}.ndjson`);
  const p = probe.createProbe({ enabled: true, logPath, sessionKey: '1' });
  await p.record({ source: 'ws', sessionKey: '1', state: 'playing', positionMs: 1000, raw: { a: 1 } });
  await p.stop();
  const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
  const row = JSON.parse(lines[0]);
  expect(row.source).toBe('ws');
  expect(row.sessionKey).toBe('1');
  expect(typeof row.tLocalMs).toBe('number');
  expect(row.rawSizeBytes).toBeGreaterThan(0);
});

test('record ignores rows when disabled', async () => {
  const p = probe.createProbe({ enabled: false, logPath: '/tmp/not-used.ndjson', sessionKey: '1' });
  await p.record({ source: 'ws', sessionKey: '1', positionMs: 1 });
  expect(p.getStats().written).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/probe.test.js`  
Expected: FAIL with module/file missing for `../src/probe`.

- [ ] **Step 3: Implement minimal probe recorder**

```js
// src/probe.js
const fs = require('fs/promises');
const path = require('path');

function _normalize(row) {
  const rawJson = row.raw ? JSON.stringify(row.raw) : '';
  return {
    tLocalMs: Date.now(),
    source: row.source,
    sessionKey: String(row.sessionKey),
    state: row.state || null,
    positionMs: Number.isFinite(row.positionMs) ? row.positionMs : null,
    eventType: row.eventType || null,
    rawSizeBytes: rawJson.length,
    failureReason: row.failureReason || null,
    endpointStatus: row.endpointStatus || null,
    payload: row.raw || null,
  };
}

function createProbe(opts) {
  const enabled = Boolean(opts?.enabled);
  const logPath = opts?.logPath;
  const stats = { written: 0 };

  async function record(row) {
    if (!enabled) return;
    if (!row || String(row.sessionKey) !== String(opts.sessionKey)) return;
    const out = _normalize(row);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(out)}\n`, 'utf8');
    stats.written += 1;
  }

  async function stop() {}

  return { record, stop, getStats: () => ({ ...stats }) };
}

module.exports = { createProbe, _normalize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/probe.test.js`  
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/probe.js tests/probe.test.js
git commit -m "test: add core probe recorder with NDJSON output"
```

### Task 2: Capture WebSocket and Sessions Signals in Sync

**Files:**
- Modify: `src/sync.js`
- Modify: `main.js`
- Test: `tests/sync.test.js`

- [ ] **Step 1: Write failing sync tests for probe capture**

```js
// add to tests/sync.test.js
jest.mock('../src/probe', () => ({
  createProbe: jest.fn(() => ({ record: jest.fn().mockResolvedValue(), stop: jest.fn(), getStats: () => ({ written: 0 }) })),
}));

test('handleEvent records ws probe row for selected session', async () => {
  const probe = require('../src/probe');
  await sync.start({
    serverUrl: 'http://localhost:32400', token: 'tok',
    sessionKey: '1', ratingKey: '42', viewOffset: 5000, screenIndex: 1,
    probe: { enabled: true, logPath: '/tmp/probe.ndjson' },
    onStatus: jest.fn(),
  });
  sync.handleEvent({ PlaySessionStateNotification: [{ sessionKey: '1', state: 'playing', viewOffset: 6000 }] }, '1');
  const instance = probe.createProbe.mock.results[0].value;
  expect(instance.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'ws', sessionKey: '1', positionMs: 6000 }));
});

test('correctDrift records sessions probe row', async () => {
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(100.0);
  const probe = require('../src/probe');
  await sync.start({
    serverUrl: 'http://localhost:32400', token: 'tok',
    sessionKey: '1', ratingKey: '42', viewOffset: 5000, screenIndex: 1,
    probe: { enabled: true, logPath: '/tmp/probe.ndjson' },
    onStatus: jest.fn(),
  });
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  const instance = probe.createProbe.mock.results[0].value;
  expect(instance.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'sessions', sessionKey: '1' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/sync.test.js -t "records"`  
Expected: FAIL because `sync.start` does not accept/use probe config yet.

- [ ] **Step 3: Implement passive probe wiring in sync**

```js
// key edits in src/sync.js
const { createProbe } = require('./probe');
let _probe = null;

async function start(opts) {
  const { probe } = opts;
  _probe = createProbe({
    enabled: Boolean(probe?.enabled),
    logPath: probe?.logPath,
    sessionKey: opts.sessionKey,
  });
  // existing start body unchanged
}

function handleEvent(data, sessionKey) {
  const notif = (data.PlaySessionStateNotification || [])
    .find((n) => String(n.sessionKey) === String(sessionKey));
  if (notif) {
    _probe?.record({
      source: 'ws',
      sessionKey,
      eventType: 'PlaySessionStateNotification',
      state: notif.state,
      positionMs: typeof notif.viewOffset === 'number' ? notif.viewOffset : null,
      raw: notif,
    });
  }
  // keep current pause/resume/stop logic unchanged after probe record
}

async function correctDrift(serverUrl, token, sessionKey) {
  // after finding session
  await _probe?.record({
    source: 'sessions',
    sessionKey,
    state,
    positionMs: Number.isFinite(rawPlexMs) ? rawPlexMs : null,
    raw: session,
  });
  // existing drift logic unchanged
}

function stop() {
  _probe?.stop();
  _probe = null;
  // keep current shutdown/reset logic unchanged
}
```

- [ ] **Step 4: Run tests to verify pass and no regressions**

Run: `npm test -- tests/sync.test.js`  
Expected: PASS all sync tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync.js main.js tests/sync.test.js
git commit -m "feat: capture ws and sessions probe signals in sync loop"
```

### Task 3: Add Direct Player Timeline Poller (Prototype B)

**Files:**
- Create: `src/playerTimeline.js`
- Modify: `src/plex.js`
- Test: `tests/playerTimeline.test.js`

- [ ] **Step 1: Write failing tests for player timeline polling**

```js
// tests/playerTimeline.test.js
const { pollPlayerTimeline } = require('../src/playerTimeline');

beforeEach(() => { global.fetch = jest.fn(); });

test('returns position and state on 200 response', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ MediaContainer: { Timeline: [{ state: 'playing', time: 123456 }] } }),
  });
  const out = await pollPlayerTimeline({
    playerUrl: 'http://192.168.1.20:32500',
    token: 'tok',
    sessionKey: '1',
  });
  expect(out.ok).toBe(true);
  expect(out.positionMs).toBe(123456);
  expect(out.state).toBe('playing');
});

test('classifies unreachable player as network failure', async () => {
  global.fetch.mockRejectedValueOnce(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }));
  const out = await pollPlayerTimeline({ playerUrl: 'http://192.168.1.20:32500', token: 'tok', sessionKey: '1' });
  expect(out.ok).toBe(false);
  expect(out.failureReason).toBe('network');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/playerTimeline.test.js`  
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement poller + player metadata expansion**

```js
// src/playerTimeline.js
function _classify(errOrStatus) {
  if (typeof errOrStatus === 'number') {
    if (errOrStatus === 401 || errOrStatus === 403) return 'auth';
    return 'other';
  }
  const code = errOrStatus?.code || errOrStatus?.cause?.code;
  if (code && String(code).startsWith('ECONN')) return 'network';
  return 'other';
}

async function pollPlayerTimeline({ playerUrl, token, sessionKey }) {
  const url = `${playerUrl}/player/timeline/poll?wait=0&commandID=1&type=video&X-Plex-Token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, failureReason: _classify(res.status), endpointStatus: res.status };
    const json = await res.json();
    const tl = json?.MediaContainer?.Timeline?.[0];
    if (!tl || !Number.isFinite(tl.time)) return { ok: false, failureReason: 'missing_fields', endpointStatus: 200 };
    return { ok: true, sessionKey: String(sessionKey), positionMs: tl.time, state: tl.state || null, endpointStatus: 200, raw: tl };
  } catch (err) {
    return { ok: false, failureReason: _classify(err), endpointStatus: null };
  }
}

module.exports = { pollPlayerTimeline };
```

```js
// src/plex.js getSessions mapping addition
return (data?.MediaContainer?.Metadata || []).map(item => ({
  sessionKey: item.sessionKey,
  title: item.title,
  year: item.year,
  ratingKey: item.ratingKey,
  viewOffset: item.viewOffset || 0,
  deviceName: item.Player?.title || 'Unknown',
  state: item.Player?.state || 'playing',
  partKey: item.Media?.[0]?.Part?.[0]?.key,
  file: item.Media?.[0]?.Part?.[0]?.file,
  playerAddress: item.Player?.address || null,
  playerPort: item.Player?.port || null,
  playerMachineIdentifier: item.Player?.machineIdentifier || null,
}));
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/playerTimeline.test.js tests/plex.test.js`  
Expected: PASS for new poller tests and existing plex tests.

- [ ] **Step 5: Commit**

```bash
git add src/playerTimeline.js src/plex.js tests/playerTimeline.test.js tests/plex.test.js
git commit -m "feat: add direct player timeline poller for lan feasibility checks"
```

### Task 4: Run B Collector in Sync and Record Outcome

**Files:**
- Modify: `src/sync.js`
- Modify: `tests/sync.test.js`

- [ ] **Step 1: Write failing tests for playerTimeline probe records**

```js
// tests/sync.test.js additions
jest.mock('../src/playerTimeline', () => ({
  pollPlayerTimeline: jest.fn(),
}));

test('correctDrift records playerTimeline success row', async () => {
  const timeline = require('../src/playerTimeline');
  const probe = require('../src/probe');
  timeline.pollPlayerTimeline.mockResolvedValueOnce({ ok: true, positionMs: 7777, state: 'playing', raw: { time: 7777 } });
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(7.0);
  await sync.start({
    serverUrl: 'http://localhost:32400', token: 'tok',
    sessionKey: '1', ratingKey: '42', viewOffset: 5000, screenIndex: 1,
    probe: { enabled: true, logPath: '/tmp/probe.ndjson', enablePlayerTimeline: true },
    onStatus: jest.fn(),
  });
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  const instance = probe.createProbe.mock.results[0].value;
  expect(instance.record).toHaveBeenCalledWith(expect.objectContaining({ source: 'playerTimeline', positionMs: 7777 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync.test.js -t "playerTimeline"`  
Expected: FAIL since `sync.correctDrift` does not poll timeline yet.

- [ ] **Step 3: Implement timeline poll path with graceful fallback**

```js
// src/sync.js key edits
const { pollPlayerTimeline } = require('./playerTimeline');
let _probeOpts = { enablePlayerTimeline: false };

async function start(opts) {
  _probeOpts = { enablePlayerTimeline: Boolean(opts?.probe?.enablePlayerTimeline) };
  // keep all current start logic after probe option assignment
}

async function correctDrift(serverUrl, token, sessionKey) {
  const sessions = await plex.getSessions(serverUrl, token);
  const session = sessions.find((s) => String(s.sessionKey) === String(sessionKey));
  if (!session) return;
  if (_probeOpts.enablePlayerTimeline && session.playerAddress && session.playerPort) {
    const playerUrl = `http://${session.playerAddress}:${session.playerPort}`;
    const r = await pollPlayerTimeline({ playerUrl, token, sessionKey });
    if (r.ok) {
      await _probe?.record({ source: 'playerTimeline', sessionKey, state: r.state, positionMs: r.positionMs, endpointStatus: r.endpointStatus, raw: r.raw });
    } else {
      await _probe?.record({ source: 'playerTimeline', sessionKey, failureReason: r.failureReason, endpointStatus: r.endpointStatus, raw: null });
    }
  }
  // keep current drift-control source unchanged in prototype phase
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/sync.test.js`  
Expected: PASS and no regression in existing sync behavior tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync.js tests/sync.test.js
git commit -m "feat: record direct player timeline probe outcomes in sync"
```

### Task 5: Add Probe Controls + Analyzer Script

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/popover.html`
- Modify: `renderer/popover.js`
- Create: `scripts/analyze-probe-log.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for analyzer script**

```js
// tests/analyze-probe-log.test.js
const { summarize } = require('../scripts/analyze-probe-log');

test('summarize returns per-source counts and jitter proxy', () => {
  const rows = [
    { source: 'ws', tLocalMs: 1000, positionMs: 10000 },
    { source: 'ws', tLocalMs: 1500, positionMs: 10500 },
    { source: 'sessions', tLocalMs: 2000, positionMs: 10000 },
  ];
  const out = summarize(rows);
  expect(out.ws.count).toBe(2);
  expect(out.sessions.count).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- tests/analyze-probe-log.test.js`  
Expected: FAIL because analyzer script does not exist.

- [ ] **Step 3: Implement controls and analyzer**

```js
// scripts/analyze-probe-log.js
const fs = require('fs');

function summarize(rows) {
  const bySource = {};
  for (const row of rows) {
    bySource[row.source] ??= [];
    bySource[row.source].push(row);
  }
  const out = {};
  for (const [source, items] of Object.entries(bySource)) {
    const sorted = items.filter(i => Number.isFinite(i.positionMs)).sort((a, b) => a.tLocalMs - b.tLocalMs);
    const deltas = [];
    for (let i = 1; i < sorted.length; i += 1) {
      deltas.push((sorted[i].positionMs - sorted[i - 1].positionMs) - (sorted[i].tLocalMs - sorted[i - 1].tLocalMs));
    }
    const avgAbs = deltas.length ? deltas.reduce((s, v) => s + Math.abs(v), 0) / deltas.length : null;
    out[source] = { count: items.length, jitterAbsMs: avgAbs };
  }
  return out;
}

if (require.main === module) {
  const file = process.argv[2];
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  console.log(JSON.stringify(summarize(rows), null, 2));
}

module.exports = { summarize };
```

```js
// package.json scripts addition
"analyze:probe": "node scripts/analyze-probe-log.js"
```

```js
// preload.js sync additions
startProbe: (params) => ipcRenderer.invoke('sync:startProbe', params),
stopProbe: () => ipcRenderer.invoke('sync:stopProbe'),
```

```js
// main.js handlers
ipcMain.handle('sync:startProbe', async (_, probeOpts) => {
  config.set('probe', probeOpts);
  return { ok: true };
});
ipcMain.handle('sync:stopProbe', async () => ({ ok: true }));
```

```js
// renderer/popover.js temporary hook
document.getElementById('btn-probe-start').addEventListener('click', async () => {
  await window.api.sync.startProbe({ enabled: true, enablePlayerTimeline: true });
  document.getElementById('probe-status').textContent = 'Probe: ON';
});
```

- [ ] **Step 4: Run tests and one local dry-run**

Run: `npm test -- tests/analyze-probe-log.test.js tests/sync.test.js tests/playerTimeline.test.js`  
Expected: PASS.

Run: `npm run analyze:probe -- logs/probes/probe-log.ndjson`  
Expected: JSON summary printed with keys for `ws`, `sessions`, and optional `playerTimeline`.

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js renderer/popover.js renderer/popover.html scripts/analyze-probe-log.js tests/analyze-probe-log.test.js package.json
git commit -m "feat: add probe controls and signal comparison analyzer"
```

### Task 6: Execute Capture Session and Produce Findings

**Files:**
- Create: `docs/superpowers/specs/2026-04-29-plex-playback-signal-prototype-findings.md`

- [ ] **Step 1: Capture A-only run**

Run: `npm start` then run playback for 10-15 minutes with steady play, pause/resume, seek.  
Expected: probe log rows for `ws` and `sessions`.

- [ ] **Step 2: Capture A+B run**

Run: `npm start` with player timeline probe enabled for same scenario.  
Expected: probe log includes `playerTimeline` success rows or explicit failure rows.

- [ ] **Step 3: Analyze logs**

Run: `npm run analyze:probe -- logs/probes/probe-log.ndjson`  
Expected: per-source counts and jitter/freshness proxies.

- [ ] **Step 4: Write recommendation doc**

```md
# Plex Playback Signal Prototype Findings

- Environment: LAN Android TV projector Plex app
- A result (WS deep-inspection): report ws sample count, discovered timing fields, and median ws inter-arrival ms.
- B result (player timeline feasibility): report success rate, failureReason counts, and median position jitter proxy.
- Recommendation: [WS-primary fallback] or [Hybrid with playerTimeline primary]
- Risks: list concrete observed issues (for example, auth failures, endpoint flakiness, or no measurable precision gain).
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-plex-playback-signal-prototype-findings.md logs/probes/probe-log.ndjson
git commit -m "docs: record playback signal probe findings and recommendation"
```
