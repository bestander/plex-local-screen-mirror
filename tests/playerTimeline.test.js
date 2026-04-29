const { pollPlayerTimeline } = require('../src/playerTimeline');

beforeEach(() => {
  global.fetch = jest.fn();
});

test('returns position and state on 200 response', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ MediaContainer: { Timeline: [{ state: 'playing', time: 123456 }] } }),
  });

  const out = await pollPlayerTimeline({
    playerUrl: 'http://192.168.1.20:32500',
    token: 'tok',
    sessionKey: '1',
  });

  expect(out.ok).toBe(true);
  expect(out.positionMs).toBe(123456);
  expect(out.state).toBe('playing');
});

test('classifies unreachable player as network failure', async () => {
  global.fetch.mockRejectedValueOnce(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }));
  const out = await pollPlayerTimeline({
    playerUrl: 'http://192.168.1.20:32500',
    token: 'tok',
    sessionKey: '1',
  });

  expect(out.ok).toBe(false);
  expect(out.failureReason).toBe('network');
});
