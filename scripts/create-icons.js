const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const icons = [
  { name: 'icon-idle.png',    fill: 'rgb(150,150,150)' },
  { name: 'icon-syncing.png', fill: 'rgb(34,197,94)'   },
  { name: 'icon-error.png',   fill: 'rgb(239,68,68)'   },
];

(async () => {
  for (const icon of icons) {
    const svg = `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="${icon.fill}"/>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(assetsDir, icon.name));
    console.log(`Created ${icon.name}`);
  }
})();
