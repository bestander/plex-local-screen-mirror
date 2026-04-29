const fs = require('fs/promises');
const path = require('path');

function _normalize(row) {
  const rawJson = row.raw ? JSON.stringify(row.raw) : '';
  return {
    tLocalMs: Date.now(),
    source: row.source,
    sessionKey: String(row.sessionKey),
    state: row.state || null,
    positionMs: Number.isFinite(row.positionMs) ? row.positionMs : null,
    eventType: row.eventType || null,
    rawSizeBytes: rawJson.length,
    failureReason: row.failureReason || null,
    endpointStatus: row.endpointStatus || null,
    payload: row.raw || null,
  };
}

function createProbe(opts) {
  const enabled = Boolean(opts?.enabled);
  const logPath = opts?.logPath;
  const targetSessionKey = String(opts?.sessionKey || '');
  const stats = { written: 0 };

  async function record(row) {
    if (!enabled) return;
    if (!row || String(row.sessionKey) !== targetSessionKey) return;
    const out = _normalize(row);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(out)}\n`, 'utf8');
    stats.written += 1;
  }

  async function stop() {}

  function getStats() {
    return { ...stats };
  }

  return { record, stop, getStats };
}

module.exports = { createProbe, _normalize };
