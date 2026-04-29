let selectedSessionKey = null;
let selectedRatingKey = null;
let selectedViewOffset = 0;
let pollInterval = null;

function renderProbeStatus(cfg) {
  const statusEl = document.getElementById('probe-status');
  if (!cfg?.enabled) {
    statusEl.textContent = 'Probe: OFF';
    return;
  }
  const suffix = cfg.enablePlayerTimeline ? ' (with player timeline)' : '';
  statusEl.textContent = `Probe: ON${suffix}`;
}

async function saveProbeConfig() {
  const enabled = document.getElementById('probe-enabled').checked;
  const enablePlayerTimeline = document.getElementById('probe-player-timeline').checked;
  if (enabled) {
    const cfg = await window.api.sync.startProbe({ enabled, enablePlayerTimeline });
    renderProbeStatus(cfg);
    return;
  }
  await window.api.sync.stopProbe();
  renderProbeStatus({ enabled: false, enablePlayerTimeline: false });
}

async function loadLaunchAtLoginState() {
  const enabled = await window.api.app.getLaunchAtLogin();
  document.getElementById('launch-at-login').checked = Boolean(enabled);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

async function loadDisplays(preferredId) {
  const displays = await window.api.plex.getDisplays();
  const sel = document.getElementById('screen-select');
  sel.innerHTML = displays.map((d) => {
    const isSelected = d.id === preferredId || String(d.id) === String(preferredId);
    return `<option value="${d.id}" ${isSelected ? 'selected' : ''}>${d.label}</option>`;
  }).join('');
}

async function init() {
  const cfg = await window.api.config.load();
  if (!cfg.token) { showView('view-signin'); return; }

  document.getElementById('footer-email').textContent = cfg.email || '';
  document.getElementById('footer-server').textContent = cfg.serverUrl;
  document.getElementById('footer-email-s').textContent = cfg.email || '';
  document.getElementById('footer-server-s').textContent = cfg.serverUrl;
  document.getElementById('server-url').value = cfg.serverUrl;
  const probeCfg = cfg.probeConfig || { enabled: false, enablePlayerTimeline: false };
  document.getElementById('probe-enabled').checked = Boolean(probeCfg.enabled);
  document.getElementById('probe-player-timeline').checked = Boolean(probeCfg.enablePlayerTimeline);
  renderProbeStatus(probeCfg);
  await loadLaunchAtLoginState();

  await loadDisplays(cfg.lastScreenId);

  showView('view-idle');
  loadSessions();
  pollInterval = setInterval(loadSessions, 5000);
}

async function loadSessions() {
  const sessions = await window.api.plex.getSessions();
  const list = document.getElementById('sessions-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-msg">No active Plex sessions</div>';
    selectedSessionKey = null;
    document.getElementById('btn-play').disabled = true;
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.sessionKey === selectedSessionKey ? 'selected' : ''}"
         data-key="${s.sessionKey}" data-rating="${s.ratingKey}" data-offset="${s.viewOffset}">
      <div class="session-dot"></div>
      <span>${s.title} — ${s.deviceName}</span>
    </div>
  `).join('');
  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedSessionKey = el.dataset.key;
      selectedRatingKey = el.dataset.rating;
      selectedViewOffset = parseInt(el.dataset.offset, 10);
      list.querySelectorAll('.session-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('btn-play').disabled = false;
    });
  });
}

document.getElementById('btn-signin').addEventListener('click', async () => {
  const btn = document.getElementById('btn-signin');
  const err = document.getElementById('signin-error');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  err.textContent = '';
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const serverUrl = document.getElementById('server-url').value;
    await window.api.config.set('serverUrl', serverUrl);
    await window.api.plex.signIn(email, password);
    await init();
  } catch {
    err.textContent = 'Sign in failed. Check email and password.';
    btn.disabled = false;
    btn.textContent = 'Sign in to Plex';
  }
});

document.getElementById('btn-play').addEventListener('click', async () => {
  if (!selectedSessionKey) return;
  await saveProbeConfig();
  clearInterval(pollInterval);
  const screenId = parseInt(document.getElementById('screen-select').value, 10);
  await window.api.sync.start({
    sessionKey: selectedSessionKey,
    ratingKey: selectedRatingKey,
    viewOffset: selectedViewOffset,
    screenId,
  });
});

document.getElementById('probe-enabled').addEventListener('change', saveProbeConfig);
document.getElementById('probe-player-timeline').addEventListener('change', async () => {
  const enabled = document.getElementById('probe-enabled').checked;
  if (!enabled) return;
  await saveProbeConfig();
});

document.getElementById('btn-reload-screens').addEventListener('click', async () => {
  const currentId = document.getElementById('screen-select').value;
  await loadDisplays(currentId);
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  await window.api.sync.stop();
});

async function refreshLagDisplay() {
  const lag = await window.api.sync.getDisplayLag();
  document.getElementById('lag-value').textContent = `${lag} ms`;
}

window.api.sync.onStatus((status) => {
  if (status.state === 'syncing') {
    showView('view-syncing');
    refreshLagDisplay();
  } else {
    showView('view-idle');
    pollInterval = setInterval(loadSessions, 5000);
    loadSessions();
  }
});

document.getElementById('btn-lag-minus').addEventListener('click', async () => {
  await window.api.sync.nudgeDisplayLag(-250);
  refreshLagDisplay();
});
document.getElementById('btn-lag-plus').addEventListener('click', async () => {
  await window.api.sync.nudgeDisplayLag(250);
  refreshLagDisplay();
});

document.getElementById('launch-at-login').addEventListener('change', async (event) => {
  const next = await window.api.app.setLaunchAtLogin(event.target.checked);
  event.target.checked = Boolean(next);
});

document.getElementById('btn-download').addEventListener('click', () => window.api.download.openWindow());
document.getElementById('btn-quit').addEventListener('click', () => window.api.app.quit());
document.getElementById('btn-quit-s').addEventListener('click', () => window.api.app.quit());

init();
