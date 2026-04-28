jest.mock('../src/plex');
jest.mock('../src/mpv');
jest.mock('ws');

const plex = require('../src/plex');
const mpv = require('../src/mpv');
const WebSocket = require('ws');
const sync = require('../src/sync');

beforeEach(() => {
  jest.clearAllMocks();
  mpv.isAlive.mockReturnValue(false);
  mpv.launch.mockResolvedValue();
  mpv.pause.mockResolvedValue();
  mpv.resume.mockResolvedValue();
  mpv.seek.mockResolvedValue();
  mpv.quit.mockImplementation(() => {});
  plex.getFilePath.mockResolvedValue({ file: '/movies/film.mkv', partKey: '/library/parts/1' });
  plex.getSessionPosition.mockResolvedValue(5000);
  plex.getSessions.mockResolvedValue([
    { sessionKey: '1', state: 'playing', viewOffset: 5000 },
  ]);
  const mockWs = { on: jest.fn(), close: jest.fn() };
  WebSocket.mockImplementation(() => mockWs);
  sync.reset();
});

test('start launches mpv at correct position', async () => {
  await sync.start({
    serverUrl: 'http://localhost:32400', token: 'tok',
    sessionKey: '1', ratingKey: '42', viewOffset: 5000, screenIndex: 1,
    onStatus: jest.fn(),
  });
  expect(mpv.launch).toHaveBeenCalledWith('/movies/film.mkv', 1, 5.0);
});

test('handleEvent paused calls mpv.pause', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: '1', state: 'paused', viewOffset: 5000 },
  ]}, '1');
  expect(mpv.pause).toHaveBeenCalled();
});

test('handleEvent playing after pause calls mpv.resume', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: '1', state: 'paused', viewOffset: 5000 },
  ]}, '1');
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: '1', state: 'playing', viewOffset: 5100 },
  ]}, '1');
  expect(mpv.resume).toHaveBeenCalled();
});

test('handleEvent stopped calls mpv.quit', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: '1', state: 'stopped', viewOffset: 0 },
  ]}, '1');
  expect(mpv.quit).toHaveBeenCalled();
});

test('handleEvent accepts numeric session key for paused event', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: 1, state: 'paused', viewOffset: 5000 },
  ]}, '1');
  expect(mpv.pause).toHaveBeenCalled();
});

test('handleEvent pauses on timeline notification type', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'timeline', PlaySessionStateNotification: [
    { sessionKey: '1', state: 'paused', viewOffset: 5000 },
  ]}, '1');
  expect(mpv.pause).toHaveBeenCalled();
});

test('handleEvent accepts numeric session key for stopped event', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: 1, state: 'stopped', viewOffset: 0 },
  ]}, '1');
  expect(mpv.quit).toHaveBeenCalled();
});

test('handleEvent ignores events for other sessions', () => {
  mpv.isAlive.mockReturnValue(true);
  sync.handleEvent({ type: 'playing', PlaySessionStateNotification: [
    { sessionKey: '999', state: 'paused', viewOffset: 5000 },
  ]}, '1');
  expect(mpv.pause).not.toHaveBeenCalled();
});

test('correctDrift hard-seeks when drift exceeds 8s', async () => {
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(100.0);
  plex.getSessions.mockResolvedValue([
    { sessionKey: '1', state: 'playing', viewOffset: 110000 },
  ]); // 10s ahead
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  expect(mpv.seek).toHaveBeenCalled();
});

test('correctDrift pauses when poll reports paused state', async () => {
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(100.0);
  plex.getSessions.mockResolvedValue([
    { sessionKey: '1', state: 'paused', viewOffset: 100000 },
  ]);
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  expect(mpv.pause).toHaveBeenCalled();
});

test('correctDrift uses speed adjustment for moderate drift', async () => {
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(100.0);
  plex.getSessions.mockResolvedValue([
    { sessionKey: '1', state: 'playing', viewOffset: 102500 },
  ]); // 2.5s drift (well above 500ms noise)
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  expect(mpv.seek).not.toHaveBeenCalled();
  expect(mpv.setSpeed).toHaveBeenCalled();
});

test('correctDrift sets 1.0x speed when drift is in noise floor', async () => {
  // mpv at 100s, plex at 99950ms. With default 1500ms display lag, target = 101450ms
  // mpv at 100000ms means drift = 101450 - 100000 = 1450ms... that's outside noise floor
  // So we need a smaller drift. Set displayLag = 0 for this test.
  sync.setDisplayLag(0);
  mpv.isAlive.mockReturnValue(true);
  mpv.getPosition.mockResolvedValue(100.0);
  plex.getSessions.mockResolvedValue([
    { sessionKey: '1', state: 'playing', viewOffset: 100100 },
  ]); // 100ms drift, below 200ms noise
  await sync.correctDrift('http://localhost:32400', 'tok', '1');
  expect(mpv.seek).not.toHaveBeenCalled();
  expect(mpv.setSpeed).not.toHaveBeenCalled();
  sync.setDisplayLag(1500);  // restore default for other tests
});
