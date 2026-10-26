import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPhotos, replacePhotos } from '../src/photos.js';
test('missing key and failed requests reject rather than return destructive empty results', async () => {
  await assert.rejects(() => fetchPhotos('Japan', ''), /API key/);
  await assert.rejects(
    () => fetchPhotos('Japan', 'key', { fetcher: async () => ({ ok: false, status: 429 }) }),
    /limit/,
  );
  await assert.rejects(
    () =>
      fetchPhotos('Japan', 'key', {
        fetcher: async () => ({ ok: true, json: async () => ({ photos: [] }) }),
      }),
    /kept/,
  );
});
test('regeneration preserves locked images, deduplicates, and caps at five', () => {
  const locked = { src: 'https://example.com/locked', locked: true };
  const photos = Array.from({ length: 8 }, (_, i) => ({
    src: `https://example.com/${i}`,
    locked: false,
  }));
  const result = replacePhotos(
    [locked, { src: 'https://example.com/old', locked: false }],
    [locked, ...photos, photos[0]],
  );
  assert.equal(result.length, 5);
  assert.deepEqual(result[0], locked);
  assert.equal(new Set(result.map((p) => p.src)).size, 5);
});
test('photo requests carry abort signals and validate media URLs', async () => {
  const controller = new AbortController();
  let passed;
  const photos = await fetchPhotos('Japan', 'key', {
    signal: controller.signal,
    fetcher: async (url, options) => {
      passed = options.signal;
      return {
        ok: true,
        json: async () => ({
          photos: [{ src: { landscape: 'https://example.com/photo' }, url: 'javascript:alert(1)' }],
        }),
      };
    },
  });
  assert.equal(passed, controller.signal);
  assert.equal(photos[0].url, '');
});
