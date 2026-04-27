const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

const IPC_SOCKET = '/tmp/mpv-sauna.sock';

let _proc = null;
let _caffeinate = null;

function _waitForSocket(timeout) {
  timeout = timeout || 3000;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(IPC_SOCKET)) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('mpv IPC socket timeout'));
      setTimeout(check, 100);
    };
    check();
  });
}

function _sendCommand(cmd) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const sock = net.createConnection(IPC_SOCKET, () => {
        sock.write(JSON.stringify(cmd) + '\n');
        sock.end();
      });
      sock.on('close', finish);
      sock.on('error', finish);
      setTimeout(() => { try { sock.destroy(); } catch {} ; finish(); }, 1000);
    } catch { finish(); }
  });
}

async function launch(filePath, screenIndex, startPosSecs) {
  _proc = spawn('mpv', [
    filePath,
    `--screen=${screenIndex}`,
    '--fullscreen',
    `--start=${startPosSecs}`,
    `--input-ipc-server=${IPC_SOCKET}`,
    '--no-terminal',
    '--no-audio',
    '--pause',
    // Apple VideoToolbox HW decode with copy-back so software filters still
    // work on the decoded frames. Big CPU win for 4K HEVC.
    '--hwdec=videotoolbox-copy',
    // Cap output to 1080p height (anything bigger is downscaled, smaller is
    // upscaled — but the ASUS panel is 1080p anyway). Simple unconditional
    // form to avoid mpv filter-parse comma issues.
    '--vf=scale=-2:1080',
  ]);
  await _waitForSocket();
  await _sendCommand({ command: ['set_property', 'pause', false] });
  _caffeinate = spawn('caffeinate', ['-di']);
}

async function pause() {
  return _sendCommand({ command: ['set_property', 'pause', true] });
}

async function resume() {
  return _sendCommand({ command: ['set_property', 'pause', false] });
}

async function seek(posSecs) {
  return _sendCommand({ command: ['seek', posSecs, 'absolute'] });
}

async function setSpeed(rate) {
  return _sendCommand({ command: ['set_property', 'speed', rate] });
}

async function getPosition() {
  return new Promise((resolve) => {
    try {
      const sock = net.createConnection(IPC_SOCKET);
      const cmd = { command: ['get_property', 'time-pos'], request_id: 1 };
      sock.write(JSON.stringify(cmd) + '\n');
      sock.setTimeout(1000);
      let buf = '';
      sock.on('data', (data) => {
        buf += data.toString();
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.request_id === 1) {
              sock.destroy();
              resolve(msg.error === 'success' ? msg.data : null);
            }
          } catch {}
        }
      });
      sock.on('timeout', () => { sock.destroy(); resolve(null); });
      sock.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

function isAlive() {
  return _proc !== null && _proc.exitCode === null;
}

function quit() {
  _sendCommand({ command: ['quit'] }).catch(() => {});
  if (_caffeinate) { _caffeinate.kill(); _caffeinate = null; }
  _proc = null;
  if (fs.existsSync(IPC_SOCKET)) { try { fs.unlinkSync(IPC_SOCKET); } catch {} }
}

function _reset() { _proc = null; _caffeinate = null; }

module.exports = { launch, pause, resume, seek, setSpeed, getPosition, isAlive, quit, _reset };
