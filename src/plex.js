const path = require('path');

const JSON_ACCEPT = { Accept: 'application/json' };

function authHeader(token) {
  return { 'X-Plex-Token': token, ...JSON_ACCEPT };
}

async function signIn(email, password) {
  const body = new URLSearchParams({
    'user[login]': email,
    'user[password]': password,
  });
  const res = await fetch('https://plex.tv/users/sign_in.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Plex-Client-Identifier': 'sauna-plex',
      'X-Plex-Product': 'Sauna Plex',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('Sign in failed');
  const data = await res.json();
  return { token: data.user.authToken, email: data.user.email, username: data.user.username };
}

async function getSessions(serverUrl, token) {
  try {
    const res = await fetch(`${serverUrl}/status/sessions`, { headers: authHeader(token) });
    if (!res.ok) return [];
    const data = await res.json();
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
    }));
  } catch { return []; }
}

async function getSessionPosition(serverUrl, token, sessionKey) {
  const sessions = await getSessions(serverUrl, token);
  const session = sessions.find(s => s.sessionKey === sessionKey);
  return session ? session.viewOffset : null;
}

async function getFilePath(serverUrl, token, ratingKey) {
  const res = await fetch(`${serverUrl}/library/metadata/${ratingKey}`, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Failed to get metadata for ${ratingKey}`);
  const data = await res.json();
  const part = data?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0];
  if (!part) throw new Error(`No media part found for ${ratingKey}`);
  return { file: part.file, partKey: part.key };
}

function _orderedUris(connections) {
  const uris = [];
  // Local connections first: try extracting raw IP before using .plex.direct hostname
  for (const c of connections.filter(c => c.local)) {
    const fromAddr = c.address?.match(/^(\d+-\d+-\d+-\d+)\./);
    if (fromAddr) uris.push(`http://${fromAddr[1].replace(/-/g, '.')}:${c.port}`);
    const fromUri = c.uri?.match(/\/\/(\d+-\d+-\d+-\d+)\./);
    if (fromUri) uris.push(`http://${fromUri[1].replace(/-/g, '.')}:${c.port}`);
    uris.push(c.uri);
  }
  // Relay / remote connections as last resort
  for (const c of connections.filter(c => !c.local)) uris.push(c.uri);
  return [...new Set(uris.filter(Boolean))];
}

async function getRemoteServers(token) {
  const url = `https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&X-Plex-Token=${token}`;
  const res = await fetch(url, {
    headers: { 'X-Plex-Client-Identifier': 'sauna-plex', Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter(r => r.provides.includes('server') && !r.owned)
    .map(r => ({
      name: r.name,
      clientIdentifier: r.clientIdentifier,
      accessToken: r.accessToken,
      uris: _orderedUris(r.connections),
    }));
}

async function getLocalSections(serverUrl, token) {
  const res = await fetch(`${serverUrl}/library/sections`, { headers: authHeader(token) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.MediaContainer?.Directory || [])
    .filter(s => s.type === 'movie')
    .map(s => ({ id: s.key, title: s.title, path: s.Location?.[0]?.path || '' }));
}

function _parseMovies(metadata) {
  return (metadata || []).map(item => ({
    title: item.title,
    year: item.year,
    ratingKey: item.ratingKey,
    media: (item.Media || []).map(m => ({
      partKey: m.Part?.[0]?.key,
      filename: m.Part?.[0]?.file
        ? path.basename(m.Part[0].file)
        : `${item.title} (${item.year}).mkv`,
      size: m.Part?.[0]?.size || 0,
      videoResolution: m.videoResolution || '',
      bitrate: m.bitrate || 0,
    })),
  }));
}

async function searchMovies(serverUri, accessToken, query) {
  const sectionsRes = await fetch(`${serverUri}/library/sections`, { headers: authHeader(accessToken) });
  const sectionsData = await sectionsRes.json();
  const movieSections = (sectionsData?.MediaContainer?.Directory || []).filter(s => s.type === 'movie');
  const results = [];
  for (const section of movieSections) {
    // Empty query = list all movies in section
    const endpoint = query
      ? `${serverUri}/library/sections/${section.key}/search?query=${encodeURIComponent(query)}&type=1`
      : `${serverUri}/library/sections/${section.key}/all?type=1`;
    const res = await fetch(endpoint, { headers: authHeader(accessToken) });
    const data = await res.json();
    results.push(..._parseMovies(data?.MediaContainer?.Metadata));
  }
  return results;
}

async function searchMoviesWithFallback(uris, accessToken, query) {
  let lastErr;
  for (const uri of uris) {
    try {
      return await searchMovies(uri, accessToken, query);
    } catch (err) {
      console.log(`[plex] ${uri} failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All server connections failed');
}

async function triggerLibraryScan(serverUrl, token, sectionId) {
  await fetch(`${serverUrl}/library/sections/${sectionId}/refresh?X-Plex-Token=${token}`);
}

module.exports = {
  signIn, getSessions, getSessionPosition, getFilePath,
  getRemoteServers, getLocalSections, searchMovies, searchMoviesWithFallback, triggerLibraryScan,
};
