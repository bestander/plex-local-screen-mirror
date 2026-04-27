const fs = require('fs');
const https = require('https');
const { EventEmitter } = require('events');

jest.mock('fs');
jest.mock('https');

const { downloadFile } = require('../src/download');

test('downloadFile writes chunks and calls onProgress', async () => {
  const mockWriteStream = { write: jest.fn(), end: jest.fn(), destroy: jest.fn(), on: jest.fn() };
  fs.createWriteStream.mockReturnValue(mockWriteStream);

  const mockResponse = new EventEmitter();
  mockResponse.headers = { 'content-length': '100' };
  https.get.mockImplementation((url, cb) => { cb(mockResponse); return { on: jest.fn() }; });

  const progressCalls = [];
  const promise = downloadFile({
    url: 'https://example.com/movie.mkv',
    savePath: '/tmp/movie.mkv',
    onProgress: (p) => progressCalls.push(p),
  });

  mockResponse.emit('data', Buffer.alloc(60));
  mockResponse.emit('data', Buffer.alloc(40));
  mockResponse.emit('end');

  await promise;

  expect(mockWriteStream.write).toHaveBeenCalledTimes(2);
  expect(progressCalls).toHaveLength(2);
  expect(progressCalls[0].percent).toBeCloseTo(60);
  expect(progressCalls[1].percent).toBeCloseTo(100);
  expect(mockWriteStream.end).toHaveBeenCalled();
});

test('downloadFile deletes partial file on error', async () => {
  const mockWriteStream = { write: jest.fn(), end: jest.fn(), destroy: jest.fn(), on: jest.fn() };
  fs.createWriteStream.mockReturnValue(mockWriteStream);
  fs.existsSync.mockReturnValue(true);
  fs.unlinkSync.mockImplementation(() => {});

  const mockResponse = new EventEmitter();
  mockResponse.headers = {};
  https.get.mockImplementation((url, cb) => { cb(mockResponse); return { on: jest.fn() }; });

  const promise = downloadFile({ url: 'https://example.com/movie.mkv', savePath: '/tmp/movie.mkv' });
  mockResponse.emit('error', new Error('network fail'));

  await expect(promise).rejects.toThrow('network fail');
  expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/movie.mkv');
});
