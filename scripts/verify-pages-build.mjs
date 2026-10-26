import { readFile, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const base = new URL('https://rojamich.github.io/travel-tierlist/');
const root = resolve('dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
let files = 0;
for (const source of urls) {
  if (source.startsWith('#')) continue;
  const url = new URL(source, base);
  if (url.origin !== base.origin) continue;
  assert.ok(url.pathname.startsWith(base.pathname), `Asset escapes the project URL: ${source}`);
  const file = resolve(root, decodeURIComponent(url.pathname.slice(base.pathname.length)));
  assert.ok(!relative(root, file).startsWith('..'), `Invalid asset path: ${source}`);
  await access(file);
  files++;
}
assert.match(html, /(?:src|href)="\.\/assets\/index-[^"/]+\.js"/);
assert.match(html, /href="\.\/assets\/index-[^"/]+\.css"/);
assert.doesNotMatch(html, /(?:src|href)="\/?(?:src\/app\.js|styles\.css)"/);
await access(resolve(root, 'sw.js'));
await access(resolve(root, 'manifest.webmanifest'));
console.log(`Verified ${files} built assets under ${base.pathname}; source entry points are absent.`);
