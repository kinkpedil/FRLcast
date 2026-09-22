// Vendors the English OCR language data so the operator panel works with no internet.
//   node scripts/fetch-tessdata.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'vendor', 'tessdata');
const URL_ = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';

fs.mkdirSync(OUT_DIR, { recursive: true });
const dest = path.join(OUT_DIR, 'eng.traineddata.gz');

console.log(`downloading ${URL_}`);
const res = await fetch(URL_);
if (!res.ok) {
  console.error(`failed: HTTP ${res.status}`);
  process.exit(1);
}
fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
console.log(`saved ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
console.log('OCR now runs fully offline.');
