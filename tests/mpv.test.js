const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

jest.mock('child_process');
jest.mock('net');
jest.mock('fs');

const mpv = require('../src/mpv');

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  fs.unlinkSync.mockImplementation(() => {});
  mpv._reset();
});

test('launch spawns mpv with correct args', async () => {
  const mockProc = { exitCode: null, kill: jest.fn() };
  spawn.mockReturnValue(mockProc);
  fs.existsSync.mockReturnValueOnce(false).mockReturnValue(true);
  const mockSock = { write: jest.fn(), end: jest.fn(), on: jest.fn((ev, cb) => { if (ev === 'close') setImmediate(cb); }), destroy: jest.fn() };
  net.createConnection.mockImplementation((_path, connectCb) => { if (connectCb) setImmediate(connectCb); return mockSock; });

  await mpv.launch('/movies/film.mkv', 1, 123.4);

  expect(spawn.mock.calls[0][0]).toBe('mpv');
  const args = spawn.mock.calls[0][1];
  expect(args).toContain('/movies/film.mkv');
  expect(args).toContain('--screen=1');
  expect(args).toContain('--start=123.4');
  expect(args).toContain('--no-audio');
  expect(args).toContain('--fullscreen');
});

test('pause sends correct IPC command', async () => {
  fs.existsSync.mockReturnValue(true);
  const mockSock = { write: jest.fn(), end: jest.fn(), on: jest.fn((ev, cb) => { if (ev === 'close') setImmediate(cb); }) };
  net.createConnection.mockImplementation((_path, connectCb) => { if (connectCb) setImmediate(connectCb); return mockSock; });

  await mpv.pause();

  const written = JSON.parse(mockSock.write.mock.calls[0][0]);
  expect(written.command).toEqual(['set_property', 'pause', true]);
});

test('resume sends correct IPC command', async () => {
  fs.existsSync.mockReturnValue(true);
  const mockSock = { write: jest.fn(), end: jest.fn(), on: jest.fn((ev, cb) => { if (ev === 'close') setImmediate(cb); }) };
  net.createConnection.mockImplementation((_path, connectCb) => { if (connectCb) setImmediate(connectCb); return mockSock; });

  await mpv.resume();

  const written = JSON.parse(mockSock.write.mock.calls[0][0]);
  expect(written.command).toEqual(['set_property', 'pause', false]);
});

test('seek sends correct IPC command', async () => {
  fs.existsSync.mockReturnValue(true);
  const mockSock = { write: jest.fn(), end: jest.fn(), on: jest.fn((ev, cb) => { if (ev === 'close') setImmediate(cb); }) };
  net.createConnection.mockImplementation((_path, connectCb) => { if (connectCb) setImmediate(connectCb); return mockSock; });

  await mpv.seek(456.7);

  const written = JSON.parse(mockSock.write.mock.calls[0][0]);
  expect(written.command).toEqual(['seek', 456.7, 'absolute']);
});

test('isAlive returns false when not launched', () => {
  expect(mpv.isAlive()).toBe(false);
});
