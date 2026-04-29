const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const probe = require('../src/probe');

test('record writes one NDJSON line with normalized fields', async () => {
  const logPath = path.join(os.tmpdir(), `probe-${Date.now()}.ndjson`);
  const p = probe.createProbe({ enabled: true, logPath, sessionKey: '1' });

  await p.record({
    source: 'ws',
    sessionKey: '1',
    state: 'playing',
    positionMs: 1000,
    raw: { a: 1 },
  });

  await p.stop();
  const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
  const row = JSON.parse(lines[0]);

  expect(row.source).toBe('ws');
  expect(row.sessionKey).toBe('1');
  expect(typeof row.tLocalMs).toBe('number');
  expect(row.rawSizeBytes).toBeGreaterThan(0);
});

test('record ignores rows when disabled', async () => {
  const p = probe.createProbe({ enabled: false, logPath: '/tmp/not-used.ndjson', sessionKey: '1' });
  await p.record({ source: 'ws', sessionKey: '1', positionMs: 1 });
  expect(p.getStats().written).toBe(0);
});
