const fs = require('fs');
const path = require('path');
const os = require('os');
const { createConfig } = require('../src/config');

let tmpPath;
beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `sauna-plex-test-${Date.now()}.json`);
});
afterEach(() => {
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
});

test('load returns defaults when file does not exist', () => {
  const config = createConfig(tmpPath);
  expect(config.load()).toEqual({
    token: null,
    serverUrl: 'http://localhost:32400',
    lastScreenId: null,
  });
});

test('save and load round-trips data', () => {
  const config = createConfig(tmpPath);
  config.save({ token: 'abc', serverUrl: 'http://localhost:32400', lastScreenId: 99 });
  expect(config.load().token).toBe('abc');
  expect(config.load().lastScreenId).toBe(99);
});

test('set updates a single key without losing others', () => {
  const config = createConfig(tmpPath);
  config.save({ token: 'abc', serverUrl: 'http://localhost:32400', lastScreenId: null });
  config.set('lastScreenId', 42);
  expect(config.load().token).toBe('abc');
  expect(config.load().lastScreenId).toBe(42);
});

test('get retrieves a single key', () => {
  const config = createConfig(tmpPath);
  config.save({ token: 'xyz', serverUrl: 'http://localhost:32400', lastScreenId: null });
  expect(config.get('token')).toBe('xyz');
});
