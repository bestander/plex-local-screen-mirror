let selectedSessionKey = null;
let selectedRatingKey = null;
let selectedViewOffset = 0;
let pollInterval = null;

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

async function init() {
  const cfg = await window.api.config.load();
  if (!cfg.token) { showView('view-signin'); return; }

  document.getElementById('footer-email').textContent = cfg.email || '';
  document.getElementById('footer-server').textContent = cfg.serverUrl;
  document.getElementById('footer-email-s').textContent = cfg.email || '';
  document.getElementById('footer-server-s').textContent = cfg.serverUrl;
  document.getElementById('server-url').value = cfg.serverUrl;

  const displays = await window.api.plex.getDisplays();
  const sel = document.getElementById('screen-select');
  sel.innerHTML = displays.map(d =>
    `<option value="${d.id}" ${d.id === cfg.lastScreenId ? 'selected' : ''}>${d.label}</option>`
  ).join('');

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
  clearInterval(pollInterval);
  const screenId = parseInt(document.getElementById('screen-select').value, 10);
  await window.api.sync.start({
    sessionKey: selectedSessionKey,
    ratingKey: selectedRatingKey,
    viewOffset: selectedViewOffset,
    screenId,
  });
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

document.getElementById('btn-download').addEventListener('click', () => window.api.download.openWindow());
document.getElementById('btn-quit').addEventListener('click', () => window.api.app.quit());
document.getElementById('btn-quit-s').addEventListener('click', () => window.api.app.quit());

init();
