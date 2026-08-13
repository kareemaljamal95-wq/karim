// Copies non-TS runtime assets into dist/ after a tsc build.
const fs = require('node:fs');
const path = require('node:path');

const assets = [['src/db/schema.sql', 'dist/db/schema.sql']];

for (const [from, to] of assets) {
  const src = path.resolve(__dirname, '..', from);
  const dest = path.resolve(__dirname, '..', to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${from} -> ${to}`);
}
