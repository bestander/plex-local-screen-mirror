const fs = require('fs');

function summarize(rows) {
  const bySource = {};
  for (const row of rows) {
    bySource[row.source] ??= [];
    bySource[row.source].push(row);
  }

  const summary = {};
  for (const [source, items] of Object.entries(bySource)) {
    const sorted = items
      .filter((i) => Number.isFinite(i.positionMs) && Number.isFinite(i.tLocalMs))
      .sort((a, b) => a.tLocalMs - b.tLocalMs);
    const deltas = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const posDelta = sorted[i].positionMs - sorted[i - 1].positionMs;
      const wallDelta = sorted[i].tLocalMs - sorted[i - 1].tLocalMs;
      deltas.push(posDelta - wallDelta);
    }
    const jitterAbsMs = deltas.length
      ? deltas.reduce((sum, v) => sum + Math.abs(v), 0) / deltas.length
      : null;
    summary[source] = { count: items.length, jitterAbsMs };
  }
  return summary;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/analyze-probe-log.js <path-to-ndjson>');
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const rows = lines.map((line) => JSON.parse(line));
  console.log(JSON.stringify(summarize(rows), null, 2));
}

module.exports = { summarize };
