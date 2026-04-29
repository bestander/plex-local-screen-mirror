const WebSocket = require('ws');
const plex = require('./plex');
const mpv = require('./mpv');
const { createProbe } = require('./probe');
const { pollPlayerTimeline } = require('./playerTimeline');

let _sessionKey = null;
let _ratingKey = null;
let _screenIndex = 0;
let _serverUrl = null;
let _token = null;
let _paused = false;
let _buffering = false;
let _driftInterval = null;
let _ws = null;
let _onStatus = null;
let _backoff = 1000;
let _lastPlexRaw = null;       // last raw value Plex reported
let _lastPlexUpdateAt = 0;     // wall-clock time when that raw value was first seen
let _currentSpeed = 1.0;       // last speed we sent to mpv
let _probe = null;
let _probeOpts = { enablePlayerTimeline: false };

// Player buffer / network lag. The remote device buffers ahead before displaying,
// so its visible frame leads the playhead position it reports to Plex. mpv reads
// from disk with negligible buffer, so we bias mpv forward to match what's
// actually on screen on the remote device. Adjustable at runtime via IPC.
let _displayLagMs = 1500;

function setDisplayLag(ms) { _displayLagMs = Math.max(-8000, Math.min(8000, ms)); }
function getDisplayLag() { return _displayLagMs; }

async function start(opts) {
  const { serverUrl, token, sessionKey, ratingKey, viewOffset, screenIndex, onStatus, probe } = opts;
  _sessionKey = sessionKey;
  _ratingKey = ratingKey;
  _screenIndex = screenIndex;
  _serverUrl = serverUrl;
  _token = token;
  _onStatus = onStatus;
  _paused = false;
  _buffering = false;
  _lastPlexRaw = null;
  _lastPlexUpdateAt = 0;
  _currentSpeed = 1.0;
  _probe = createProbe({
    enabled: Boolean(probe?.enabled),
    logPath: probe?.logPath,
    sessionKey,
  });
  _probeOpts = { enablePlayerTimeline: Boolean(probe?.enablePlayerTimeline) };

  // Fetch fresh position
  const freshMs = await plex.getSessionPosition(serverUrl, token, sessionKey);
  const baseMs = freshMs !== null ? freshMs : viewOffset;
  console.log(`[sync] starting at ${(baseMs / 1000).toFixed(1)}s (fresh=${freshMs}ms ui=${viewOffset}ms)`);

  const { file } = await plex.getFilePath(serverUrl, token, ratingKey);
  console.log(`[sync] file resolved: ${file}`);
  await mpv.launch(file, screenIndex, baseMs / 1000);
  console.log('[sync] mpv launched');

  await new Promise(r => setTimeout(r, 200));
  await mpv.resume();
  console.log('[sync] resume sent');

  _connectWebSocket(serverUrl, token);

  _driftInterval = setInterval(() => {
    correctDrift(serverUrl, token, sessionKey).catch(err =>
      console.log('[sync] drift error:', err.message));
  }, 1000);
  console.log('[sync] drift interval started');

  _onStatus?.({ state: 'syncing', sessionKey });
}

function _connectWebSocket(serverUrl, token) {
  const wsUrl = `${serverUrl.replace('http', 'ws')}/:/websockets/notifications?X-Plex-Token=${token}`;
  _ws = new WebSocket(wsUrl);
  _ws.on('open', () => { _backoff = 1000; console.log('[sync] WebSocket connected'); });
  _ws.on('message', (data) => {
    try { handleEvent(JSON.parse(data.toString()), _sessionKey); } catch {}
  });
  _ws.on('error', (err) => console.log('[sync] WebSocket error:', err.message));
  _ws.on('close', () => {
    if (_sessionKey) {
      console.log(`[sync] WebSocket closed, reconnecting in ${_backoff}ms`);
      setTimeout(() => _connectWebSocket(serverUrl, token), Math.min(_backoff *= 2, 30000));
    }
  });
}

function handleEvent(data, sessionKey) {
  const targetSessionKey = String(sessionKey);
  // Field finding (real Android TV stream): Plex notifications arrive under
  // NotificationContainer.PlaySessionStateNotification, not only top-level
  // PlaySessionStateNotification. Parse both forms so WS updates are not missed.
  const container = data?.NotificationContainer || null;
  const notifications = data?.PlaySessionStateNotification
    || container?.PlaySessionStateNotification
    || [];
  const notif = notifications
    .find((n) => String(n.sessionKey) === targetSessionKey);
  if (!notif) return;

  const { state, viewOffset } = notif;
  console.log(`[sync] event: state=${state} viewOffset=${viewOffset}ms`);
  _probe?.record({
    source: 'ws',
    sessionKey,
    eventType: 'PlaySessionStateNotification',
    state,
    positionMs: typeof viewOffset === 'number' ? viewOffset : null,
    raw: notif,
  });

  // Seed the position model from the WebSocket's fresh viewOffset.
  // This is more current than what /status/sessions returns when polled,
  // because it arrives the moment Plex receives the heartbeat from the client.
  // Probe finding: WS jitter (~93ms abs) is far lower than /sessions (~1750ms),
  // so WS should remain the primary timing signal when available.
  if (typeof viewOffset === 'number' && state === 'playing') {
    _lastPlexRaw = viewOffset;
    _lastPlexUpdateAt = Date.now();
  }

  if (state === 'playing') {
    if (_paused || _buffering) {
      mpv.resume();
      _paused = false;
      _buffering = false;
    }
  } else if (state === 'paused') {
    if (mpv.isAlive()) { mpv.pause(); _paused = true; }
  } else if (state === 'stopped') {
    stop();
  } else if (state === 'buffering') {
    if (mpv.isAlive() && !_paused) { mpv.pause(); _buffering = true; }
  }
}

async function correctDrift(serverUrl, token, sessionKey) {
  if (!mpv.isAlive()) {
    console.log('[sync] tick: mpv not alive');
    return;
  }

  const sessions = await plex.getSessions(serverUrl, token);
  const session = sessions.find((s) => String(s.sessionKey) === String(sessionKey));
  if (!session) {
    console.log('[sync] tick: no Plex session found');
    return;
  }
  const state = session.state || 'playing';
  const rawPlexMs = session.viewOffset;
  if (_probeOpts.enablePlayerTimeline && session.playerAddress && session.playerPort) {
    const playerUrl = `http://${session.playerAddress}:${session.playerPort}`;
    const timeline = await pollPlayerTimeline({ playerUrl, token, sessionKey });
    if (timeline.ok) {
      await _probe?.record({
        source: 'playerTimeline',
        sessionKey,
        state: timeline.state,
        positionMs: timeline.positionMs,
        endpointStatus: timeline.endpointStatus,
        raw: timeline.raw,
      });
    } else {
      await _probe?.record({
        source: 'playerTimeline',
        sessionKey,
        failureReason: timeline.failureReason,
        endpointStatus: timeline.endpointStatus,
        raw: null,
      });
    }
  }
  await _probe?.record({
    source: 'sessions',
    sessionKey,
    state,
    positionMs: Number.isFinite(rawPlexMs) ? rawPlexMs : null,
    raw: session,
  });

  // Fallback state-sync path: if WebSocket events are dropped/absent, polling
  // still reflects paused/buffering/stopped state and should control mpv.
  if (state === 'paused' || state === 'buffering') {
    if (!_paused && mpv.isAlive()) {
      await mpv.pause();
      _paused = true;
      _buffering = state === 'buffering';
    }
    console.log(`[sync] tick: ${state} (skipping correction)`);
    return;
  }

  if (state === 'stopped') {
    stop();
    return;
  }

  if (_paused || _buffering) {
    await mpv.resume();
    _paused = false;
    _buffering = false;
  }

  // Plex's /sessions API only refreshes viewOffset every ~10s.
  // Between refreshes, interpolate using wall-clock time to estimate true playback position.
  const now = Date.now();
  if (rawPlexMs !== _lastPlexRaw) {
    _lastPlexRaw = rawPlexMs;
    _lastPlexUpdateAt = now;
  }
  const interpolatedMs = _lastPlexRaw + (now - _lastPlexUpdateAt);
  const targetMs = interpolatedMs + _displayLagMs;

  const mpvPosSecs = await mpv.getPosition();
  if (mpvPosSecs === null) {
    console.log('[sync] tick: mpv position unavailable, will retry');
    return;
  }

  const driftMs = targetMs - mpvPosSecs * 1000;
  const targetSpeed = _computeSpeed(driftMs);
  console.log(`[sync] plex=${rawPlexMs}ms target=${targetMs}ms mpv=${Math.round(mpvPosSecs * 1000)}ms drift=${Math.round(driftMs)}ms speed=${targetSpeed}x`);

  // Hard seek for very large drift (user seeked on the remote client)
  if (Math.abs(driftMs) > 8000) {
    console.log(`[sync] hard seek for ${Math.round(driftMs)}ms drift`);
    await mpv.seek(targetMs / 1000);
    if (_currentSpeed !== 1.0) { _currentSpeed = 1.0; await mpv.setSpeed(1.0); }
    return;
  }

  // Smooth speed adjustment for moderate drift
  if (Math.abs(targetSpeed - _currentSpeed) > 0.005) {
    _currentSpeed = targetSpeed;
    await mpv.setSpeed(targetSpeed);
  }
}

// Map drift to a target playback speed.
// Drift < 500ms = below human perception threshold AND inside our measurement
// noise (frame quantisation + Plex jitter), so leave it alone.
// Drift 500ms–8s → close gap gently over ~30s, clamped to ±5%.
function _computeSpeed(driftMs) {
  if (Math.abs(driftMs) < 500) return 1.0;
  const proposed = 1 + driftMs / 30000;       // 30s catch-up window
  const clamped = Math.max(0.95, Math.min(1.05, proposed));
  return Math.round(clamped * 1000) / 1000;
}

function stop() {
  mpv.quit();
  if (_driftInterval) { clearInterval(_driftInterval); _driftInterval = null; }
  if (_ws) { _ws.close(); _ws = null; }
  _sessionKey = null;
  _ratingKey = null;
  _paused = false;
  _buffering = false;
  _lastPlexRaw = null;
  _lastPlexUpdateAt = 0;
  _currentSpeed = 1.0;
  _probe?.stop();
  _probe = null;
  _probeOpts = { enablePlayerTimeline: false };
  _onStatus?.({ state: 'idle' });
}

function reset() {
  stop();
  _onStatus = null;
}

module.exports = { start, stop, reset, handleEvent, correctDrift, setDisplayLag, getDisplayLag };
