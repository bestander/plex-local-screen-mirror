const plex = require('../src/plex');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

beforeEach(() => {
  global.fetch = jest.fn();
});

test('signIn returns authToken on success', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ user: { authToken: 'tok123', email: 'a@b.com', username: 'user' } }),
  });
  const result = await plex.signIn('a@b.com', 'pass');
  expect(result.token).toBe('tok123');
  expect(result.email).toBe('a@b.com');
});

test('signIn throws on 401', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
  await expect(plex.signIn('a@b.com', 'wrong')).rejects.toThrow('Sign in failed');
});

test('getSessions maps Metadata to session objects', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      MediaContainer: {
        Metadata: [{
          sessionKey: '1',
          title: 'Apollo 11',
          year: 2019,
          ratingKey: '42',
          viewOffset: 5000,
          Player: {
            title: 'Living Room TV',
            state: 'playing',
            address: '192.168.1.20',
            port: 32500,
            machineIdentifier: 'android-tv-1',
          },
          Media: [{ Part: [{ key: '/library/parts/7865/file.mkv', file: '/movies/Apollo.mkv', size: 5000000000 }] }],
        }],
      },
    }),
  });
  const sessions = await plex.getSessions('http://localhost:32400', 'tok');
  expect(sessions).toHaveLength(1);
  expect(sessions[0].title).toBe('Apollo 11');
  expect(sessions[0].deviceName).toBe('Living Room TV');
  expect(sessions[0].viewOffset).toBe(5000);
  expect(sessions[0].file).toBe('/movies/Apollo.mkv');
  expect(sessions[0].playerAddress).toBe('192.168.1.20');
  expect(sessions[0].playerPort).toBe(32500);
  expect(sessions[0].playerMachineIdentifier).toBe('android-tv-1');
});

test('getSessions returns empty array on error', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false });
  const sessions = await plex.getSessions('http://localhost:32400', 'tok');
  expect(sessions).toEqual([]);
});

test('getFilePath returns file from metadata', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      MediaContainer: {
        Metadata: [{
          Media: [{ Part: [{ file: '/movies/Apollo.mkv', key: '/library/parts/42/file.mkv' }] }],
        }],
      },
    }),
  });
  const result = await plex.getFilePath('http://localhost:32400', 'tok', '42');
  expect(result.file).toBe('/movies/Apollo.mkv');
  expect(result.partKey).toBe('/library/parts/42/file.mkv');
});

test('getRemoteServers filters to non-owned server resources', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ([
      { name: 'unraid-01', provides: 'server', clientIdentifier: 'abc', accessToken: 'tok2',
        connections: [{ uri: 'http://192.168.1.10:32400', local: true }], owned: false },
      { name: 'my-mac', provides: 'server', clientIdentifier: 'def', accessToken: 'tok3',
        connections: [{ uri: 'http://localhost:32400', local: true }], owned: true },
    ]),
  });
  const servers = await plex.getRemoteServers('tok');
  expect(servers).toHaveLength(1);
  expect(servers[0].name).toBe('unraid-01');
  expect(servers[0].uris[0]).toBe('http://192.168.1.10:32400');
});

test('getLocalSections returns movie sections with path', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      MediaContainer: {
        Directory: [
          { key: '1', title: 'Movies', type: 'movie', Location: [{ path: '/Users/me/Movies' }] },
          { key: '2', title: 'TV Shows', type: 'show', Location: [{ path: '/Users/me/TV' }] },
        ],
      },
    }),
  });
  const sections = await plex.getLocalSections('http://localhost:32400', 'tok');
  expect(sections).toHaveLength(1);
  expect(sections[0].title).toBe('Movies');
  expect(sections[0].path).toBe('/Users/me/Movies');
});

test('searchMovies returns mapped results across sections', async () => {
  global.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaContainer: {
          Metadata: [{
            title: 'Apollo 11', year: 2019, ratingKey: '99',
            Media: [{
              videoResolution: '4k', bitrate: 50000,
              Part: [{ key: '/library/parts/99/file.mkv', file: '/movies/Apollo.mkv', size: 6000000000 }],
            }],
          }],
        },
      }),
    });
  const results = await plex.searchMovies('http://192.168.1.10:32400', 'tok2', 'Apollo');
  expect(results).toHaveLength(1);
  expect(results[0].title).toBe('Apollo 11');
  expect(results[0].media[0].videoResolution).toBe('4k');
});

test('getCachedMovies writes cache file and reuses it', async () => {
  const cachePath = path.join(os.tmpdir(), `plex-local-screen-mirror-cache-${Date.now()}.json`);
  global.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaContainer: {
          Metadata: [{
            title: 'Apollo 11', year: 2019, ratingKey: '99',
            Media: [{ Part: [{ key: '/library/parts/99/file.mkv', file: '/movies/Apollo.mkv', size: 6000000000 }] }],
          }],
        },
      }),
    });

  const first = await plex.getCachedMovies(['http://192.168.1.10:32400'], 'tok2', {
    cachePath,
    cacheKey: 'unraid-01',
    query: '',
  });
  expect(first).toHaveLength(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);

  global.fetch.mockReset();
  const second = await plex.getCachedMovies(['http://192.168.1.10:32400'], 'tok2', {
    cachePath,
    cacheKey: 'unraid-01',
    query: 'apollo',
  });
  expect(second).toHaveLength(1);
  expect(global.fetch).not.toHaveBeenCalled();

  await fs.unlink(cachePath);
});
