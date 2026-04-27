let selectedMedia = null;
let servers = [];

function formatBytes(bytes) {
  return bytes > 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${(bytes / 1e6).toFixed(0)} MB`;
}

async function init() {
  const [svrs, sections] = await Promise.all([
    window.api.download.getRemoteServers(),
    window.api.download.getLocalSections(),
  ]);
  servers = svrs;

  const serverSel = document.getElementById('server-select');
  serverSel.innerHTML = servers.length
    ? servers.map(s =>
        `<option value="${s.name}" data-token="${s.accessToken}">${s.name}</option>`
      ).join('')
    : '<option disabled>No servers found</option>';

  const sectionSel = document.getElementById('section-select');
  sectionSel.innerHTML = sections.length
    ? sections.map(s =>
        `<option value="${s.id}" data-path="${s.path}">${s.title} (${s.path})</option>`
      ).join('')
    : '<option disabled>No local movie libraries</option>';

  // Auto-load all movies from the first server
  if (servers.length) doSearch();
  serverSel.addEventListener('change', doSearch);
}

async function doSearch() {
  const serverSel = document.getElementById('server-select');
  const opt = serverSel.options[serverSel.selectedIndex];
  if (!opt) return;
  const query = document.getElementById('search-input').value.trim();

  const list = document.getElementById('results-list');
  list.innerHTML = `<div style="color:#888;padding:8px">${query ? 'Searching…' : 'Loading all movies…'}</div>`;

  try {
    const results = await window.api.download.search(opt.value, opt.dataset.token, query);
    renderResults(results, opt.value, opt.dataset.token);
  } catch (err) {
    list.innerHTML = `<div style="color:#f87171;padding:8px">Error: ${err.message}</div>`;
  }
}

function renderResults(results, serverName, token) {
  const list = document.getElementById('results-list');
  if (!results.length) {
    list.innerHTML = '<div style="color:#888;padding:8px">No movies found</div>';
    return;
  }
  list.innerHTML = results.flatMap(r =>
    r.media.map(m => `
      <div class="result-item"
           data-server="${serverName}"
           data-token="${token}"
           data-part-key="${m.partKey}"
           data-filename="${m.filename}"
           data-size="${m.size}">
        <div>${r.title}${r.year ? ` (${r.year})` : ''}</div>
        <div class="result-meta">${(m.videoResolution || '').toUpperCase()} · ${formatBytes(m.size)}</div>
      </div>
    `)
  ).join('');

  list.querySelectorAll('.result-item').forEach(el => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.result-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedMedia = {
        serverName: el.dataset.server,
        token: el.dataset.token,
        partKey: el.dataset.partKey,
        filename: el.dataset.filename,
        size: parseInt(el.dataset.size, 10),
      };
      document.getElementById('btn-download').disabled = false;
    });
  });
}

document.getElementById('btn-search').addEventListener('click', doSearch);

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

document.getElementById('btn-download').addEventListener('click', async () => {
  if (!selectedMedia) return;

  // Resolve download URL: use the server's first URI from main process via IPC
  const server = servers.find(s => s.name === selectedMedia.serverName);
  const serverUri = server?.uri || selectedMedia.serverName;
  const sectionSel = document.getElementById('section-select');
  const sectionId = sectionSel.value;
  const sectionPath = sectionSel.options[sectionSel.selectedIndex].dataset.path;
  const savePath = `${sectionPath}/${selectedMedia.filename}`;
  const url = `${serverUri}${selectedMedia.partKey}?X-Plex-Token=${selectedMedia.token}&download=1`;

  document.getElementById('btn-download').disabled = true;
  document.getElementById('progress-track').style.display = 'block';
  document.getElementById('status-msg').textContent = '';
  document.getElementById('status-msg').className = 'status-msg';

  window.api.download.onProgress((p) => {
    document.getElementById('progress-fill').style.width = `${p.percent.toFixed(1)}%`;
    document.getElementById('progress-label').textContent =
      `${p.percent.toFixed(1)}%  ${p.downloadedMb.toFixed(1)} / ${p.totalMb.toFixed(1)} MB`;
  });

  window.api.download.onDone(() => {
    const msg = document.getElementById('status-msg');
    msg.className = 'status-msg done';
    msg.textContent = 'Done — added to library';
  });

  window.api.download.onError((errMsg) => {
    const msg = document.getElementById('status-msg');
    msg.className = 'status-msg error';
    msg.textContent = `Error: ${errMsg}`;
    document.getElementById('btn-download').disabled = false;
  });

  await window.api.download.start({ url, savePath, sectionId });
});

init();
