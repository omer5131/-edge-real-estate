import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = '.edge-source';
const parts = fs.readdirSync(dir)
  .filter((name) => /^part-\d+\.txt$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error('Edge source archive parts are missing');
}

const encoded = parts.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
const files = JSON.parse(json);

for (const [file, content] of Object.entries(files)) {
  const parent = path.dirname(file);
  if (parent !== '.') fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const nodeTsconfigPath = 'tsconfig.node.json';
if (fs.existsSync(nodeTsconfigPath)) {
  const nodeTsconfig = JSON.parse(fs.readFileSync(nodeTsconfigPath, 'utf8'));
  nodeTsconfig.compilerOptions = {
    ...(nodeTsconfig.compilerOptions || {}),
    noEmit: true
  };
  fs.writeFileSync(nodeTsconfigPath, JSON.stringify(nodeTsconfig, null, 2) + '\n', 'utf8');
}

console.log(`Reconstructed ${Object.keys(files).length} Edge source files.`);
