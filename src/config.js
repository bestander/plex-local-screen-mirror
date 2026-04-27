const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  token: null,
  serverUrl: 'http://localhost:32400',
  lastScreenId: null,
};

function createConfig(configPath) {
  function load() {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(data) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  }

  function get(key) { return load()[key]; }

  function set(key, value) {
    const c = load();
    c[key] = value;
    save(c);
  }

  return { load, save, get, set };
}

module.exports = { createConfig };
