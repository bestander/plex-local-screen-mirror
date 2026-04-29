const { app, Tray, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const { createConfig } = require('./src/config');
const plex = require('./src/plex');
const sync = require('./src/sync');
const { downloadFile } = require('./src/download');

let tray, popoverWin, downloadWin;
const config = createConfig(path.join(app.getPath('userData'), 'config.json'));
const movieCachePath = path.join(app.getPath('userData'), 'movie-cache.json');
const probeLogPath = path.join(app.getPath('userData'), 'logs', 'probes', 'probe-log.ndjson');
const _serverUris = new Map();        // serverName -> [uris]
const _serverWorkingUri = new Map();  // serverName -> last URI that responded
const _serverTokens = new Map();      // serverName -> accessToken

app.whenReady().then(() => {
  app.dock.hide();
  // Restore saved display-lag offset
  const savedLag = config.get('displayLagMs');
  if (typeof savedLag === 'number') sync.setDisplayLag(savedLag);
  createTray();
});
app.on('window-all-closed', () => {});

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon-idle.png'));
  tray = new Tray(icon);
  tray.setToolTip('Plex Local Screen Mirror');
  tray.on('click', togglePopover);
}

function setTrayIcon(state) {
  const names = { idle: 'icon-idle', syncing: 'icon-syncing', error: 'icon-error' };
  const name = names[state] || 'icon-idle';
  tray.setImage(nativeImage.createFromPath(path.join(__dirname, 'assets', `${name}.png`)));
}

function togglePopover() {
  if (popoverWin?.isVisible()) return popoverWin.hide();
  if (!popoverWin) {
    popoverWin = new BrowserWindow({
      width: 300, height: 440, frame: false, resizable: false,
      alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    popoverWin.loadFile('renderer/popover.html');
    popoverWin.on('blur', () => popoverWin?.hide());
  }
  const b = tray.getBounds();
  popoverWin.setPosition(Math.round(b.x - 130), Math.round(b.y + b.height + 4));
  popoverWin.show();
}

ipcMain.handle('config:load', () => config.load());
ipcMain.handle('config:set', (_, key, value) => config.set(key, value));

ipcMain.handle('plex:signIn', async (_, email, password) => {
  const result = await plex.signIn(email, password);
  config.set('token', result.token);
  config.set('email', result.email);
  return result;
});

ipcMain.handle('plex:getSessions', async () => {
  const { serverUrl, token } = config.load();
  if (!token) return [];
  return plex.getSessions(serverUrl, token);
});

ipcMain.handle('plex:getDisplays', () =>
  screen.getAllDisplays().map((d, i) => ({
    id: d.id, index: i,
    label: `Display ${i + 1} (${d.size.width}\xD7${d.size.height})`,
  }))
);

ipcMain.handle('sync:start', async (_, params) => {
  const { sessionKey, ratingKey, viewOffset, screenId } = params;
  const { serverUrl, token } = config.load();
  const probeConfig = config.get('probeConfig') || {};
  const displays = screen.getAllDisplays();
  const screenIndex = displays.findIndex(d => d.id === screenId);
  config.set('lastScreenId', screenId);
  await sync.start({
    serverUrl, token, sessionKey, ratingKey, viewOffset,
    screenIndex: screenIndex === -1 ? 0 : screenIndex,
    probe: {
      enabled: Boolean(probeConfig.enabled),
      enablePlayerTimeline: Boolean(probeConfig.enablePlayerTimeline),
      logPath: probeLogPath,
    },
    onStatus: (status) => {
      setTrayIcon(status.state === 'syncing' ? 'syncing' : 'idle');
      popoverWin?.webContents.send('sync:status', status);
    },
  });
});

ipcMain.handle('sync:stop', () => sync.stop());

ipcMain.handle('sync:startProbe', (_, probeOpts = {}) => {
  const next = {
    enabled: Boolean(probeOpts.enabled),
    enablePlayerTimeline: Boolean(probeOpts.enablePlayerTimeline),
  };
  config.set('probeConfig', next);
  return { ok: true, ...next, logPath: probeLogPath };
});

ipcMain.handle('sync:stopProbe', () => {
  config.set('probeConfig', { enabled: false, enablePlayerTimeline: false });
  return { ok: true };
});

ipcMain.handle('sync:getDisplayLag', () => sync.getDisplayLag());

ipcMain.handle('sync:nudgeDisplayLag', (_, deltaMs) => {
  const next = sync.getDisplayLag() + deltaMs;
  sync.setDisplayLag(next);
  config.set('displayLagMs', sync.getDisplayLag());
  return sync.getDisplayLag();
});

ipcMain.handle('app:getLaunchAtLogin', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:setLaunchAtLogin', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('download:openWindow', () => {
  if (downloadWin && !downloadWin.isDestroyed()) return downloadWin.focus();
  downloadWin = new BrowserWindow({
    width: 480, height: 520, title: 'Download from library',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  downloadWin.loadFile('renderer/download.html');
});

ipcMain.handle('download:getRemoteServers', async () => {
  const { token } = config.load();
  const remote = await plex.getRemoteServers(token);
  _serverUris.clear();
  _serverTokens.clear();
  for (const s of remote) {
    _serverUris.set(s.name, s.uris);
    _serverTokens.set(s.name, s.accessToken);
  }
  return remote.map(s => ({ ...s, uri: s.uris[0] }));
});

ipcMain.handle('download:getLocalSections', async () => {
  const { serverUrl, token } = config.load();
  return plex.getLocalSections(serverUrl, token);
});

ipcMain.handle('download:search', async (_, serverName, accessToken, query, opts = {}) => {
  const uris = _serverUris.get(serverName) || [serverName];
  return plex.getCachedMovies(uris, accessToken, {
    cachePath: movieCachePath,
    cacheKey: serverName,
    query,
    forceRefresh: Boolean(opts.forceRefresh),
  });
});

ipcMain.handle('download:start', async (event, params) => {
  const { serverName, partKey, savePath, sectionId } = params;
  const { serverUrl, token } = config.load();
  const accessToken = _serverTokens.get(serverName);
  const uris = _serverUris.get(serverName);
  if (!accessToken || !uris) {
    event.sender.send('download:error', `Server '${serverName}' not loaded — open the download window again.`);
    return;
  }

  // Use cached working URI if available, else probe.
  let workingUri = _serverWorkingUri.get(serverName);
  if (workingUri) {
    console.log(`[download] using cached working URI: ${workingUri}`);
  } else {
    workingUri = await plex.findWorkingUri(uris, accessToken);
    if (workingUri) _serverWorkingUri.set(serverName, workingUri);
  }
  if (!workingUri) {
    event.sender.send('download:error',
      `Cannot reach ${serverName}. Check that you're on the same network or the owner has remote access enabled.`);
    return;
  }

  const url = `${workingUri}${partKey}?X-Plex-Token=${accessToken}&download=1`;
  console.log(`[download] URL: ${url.replace(accessToken, '<token>')}`);
  try {
    await downloadFile({
      url, savePath,
      onProgress: (p) => event.sender.send('download:progress', p),
    });
    await plex.triggerLibraryScan(serverUrl, token, sectionId);
    event.sender.send('download:done');
  } catch (err) {
    // Working URI failed mid-download — clear cache so next attempt re-probes.
    _serverWorkingUri.delete(serverName);
    event.sender.send('download:error', err.message);
  }
});

ipcMain.handle('app:quit', () => app.quit());
