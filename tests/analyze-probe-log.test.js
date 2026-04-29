const { summarize } = require('../scripts/analyze-probe-log');

test('summarize returns per-source counts and jitter proxy', () => {
  const rows = [
    { source: 'ws', tLocalMs: 1000, positionMs: 10000 },
    { source: 'ws', tLocalMs: 1500, positionMs: 10500 },
    { source: 'sessions', tLocalMs: 2000, positionMs: 10000 },
  ];

  const out = summarize(rows);
  expect(out.ws.count).toBe(2);
  expect(out.sessions.count).toBe(1);
});
