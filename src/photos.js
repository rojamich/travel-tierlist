import { safeUrl } from './model.js';
const styles = [
  '{country} landmarks',
  '{country} nature',
  '{country} cityscape',
  '{country} historic sites',
  '{country} travel photography',
];

export async function fetchPhotos(countryName, key, { signal, index = 0, fetcher = fetch } = {}) {
  if (!key?.trim()) throw new Error('Add your Pexels API key in Settings to find photos.');
  const query = styles[index % styles.length].replace('{country}', countryName);
  const response = await fetcher(
    `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: '15', orientation: 'landscape' })}`,
    { headers: { Authorization: key.trim() }, signal },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Photo search has reached its limit. Try again later.'
        : 'Photo search failed. Your existing photos have been kept.',
    );
  const data = await response.json();
  const photos = Array.isArray(data.photos)
    ? data.photos
        .map((photo) => ({
          src: safeUrl(photo.src?.landscape || photo.src?.medium),
          alt: photo.alt || countryName,
          photographer: photo.photographer || 'Pexels',
          url: safeUrl(photo.url),
          locked: false,
        }))
        .filter((photo) => photo.src)
    : [];
  if (!photos.length) throw new Error('No photos found. Your existing photos have been kept.');
  return photos;
}

export function replacePhotos(existing, photos) {
  const locked = existing.filter((image) => image.locked);
  const unique = new Set(locked.map((image) => image.src));
  const replacements = photos.filter((image) => {
    if (unique.has(image.src)) return false;
    unique.add(image.src);
    return true;
  });
  return [...locked, ...replacements].slice(0, 5);
}
