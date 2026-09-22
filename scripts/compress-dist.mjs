// Writes .br and .gz copies next to each text file in the built web app, so
// the server can send them compressed without compressing on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt|map)$/i;
let before = 0, after = 0, count = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!TEXT.test(name)) continue;
    const data = readFileSync(path);
    if (data.length < 1024) continue;
    const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
    writeFileSync(`${path}.br`, br);
    writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
    before += data.length; after += br.length; count++;
  }
}

walk(root);
console.log(`compressed ${count} files: ${(before / 1024).toFixed(0)} KB to ${(after / 1024).toFixed(0)} KB (brotli)`);
