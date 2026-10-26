import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name))),
    )
  ).flat();
}
const paths = (await files('dist')).filter((path) => !path.endsWith('/sw.js'));
const hash = createHash('sha256');
for (const path of paths.sort()) hash.update(await readFile(path));
const version = hash.digest('hex').slice(0, 12);
const urls = paths.map((path) => './' + relative('dist', path).replaceAll('\\', '/'));
await writeFile(
  'dist/sw.js',
  `const CACHE='travel-tiers-${version}';
const ASSETS=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('travel-tiers-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Static assets are identical across Origin headers. Vite/Pages may emit Vary: Origin.
    const key=event.request.mode==='navigate'?new URL('./index.html',self.registration.scope):event.request;
    const cached=await cache.match(key,{ignoreVary:true});if(cached)return cached;
    return fetch(event.request);
  })());
});
`,
);
console.log(`Offline app cache: ${paths.length} files (${version})`);
