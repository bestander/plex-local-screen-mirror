const https = require('https');
const http = require('http');
const fs = require('fs');

function downloadFile(opts) {
  const { url, savePath, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(savePath);
    let downloaded = 0;

    protocol.get(url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total) {
          onProgress?.({
            downloaded,
            total,
            percent: (downloaded / total) * 100,
            downloadedMb: downloaded / 1024 / 1024,
            totalMb: total / 1024 / 1024,
          });
        }
      });

      res.on('end', () => { file.end(); resolve(); });

      res.on('error', (err) => {
        file.destroy();
        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
        reject(err);
      });
    }).on('error', (err) => {
      if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
      reject(err);
    });
  });
}

module.exports = { downloadFile };
