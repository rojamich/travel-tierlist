import { cleanMeta, cleanProfile, SCORE_FIELDS, SCORE_LABELS, STATUS_LABELS } from './model.js';

// Revision IDs and server timestamps describe writes, not differences in user content.
export function sameContent(left, right, kind) {
  if (!left || !right) return left === right;
  // Field projection also equates absent scores and explicit "Not scored" values.
  return (
    JSON.stringify(comparisonFields(left, kind)) === JSON.stringify(comparisonFields(right, kind))
  );
}

export function comparisonFields(raw, kind) {
  if (!raw) return { 'Saved version': 'Missing' };
  if (kind === 'profile') {
    const data = cleanProfile(raw);
    return Object.fromEntries([
      ...['expected', 'experienced'].flatMap((phase) => [
        ...SCORE_FIELDS.map((key) => [
          `${phase === 'expected' ? 'Before' : 'After'} · ${SCORE_LABELS[key]}`,
          data[phase].scores?.[key] ?? 'Not scored',
        ]),
        [
          `${phase === 'expected' ? 'Before' : 'After'} · imported total`,
          data[phase].legacyTotal ?? 'None',
        ],
      ]),
      ['Notes', data.notes],
      ['Before-trip notes', data.preNotes],
      ['After-trip notes', data.postNotes],
    ]);
  }
  const d = cleanMeta(raw);
  return Object.fromEntries([
    ['Destination', d.name],
    ['Status', STATUS_LABELS[d.status]],
    ['Deleted', String(d.deleted)],
    ['Best time', d.bestTime],
    ['Time needed', d.days],
    ['Budget amount', d.budget.amount ?? 'Not set'],
    ['Currency', d.budget.currency],
    ['Budget covers', d.budget.basis],
    ['Budget days', d.budget.days ?? 'Not set'],
    ['Previous budget', d.budget.legacy],
    ['Interests', JSON.stringify(d.attractions)],
    ['Manual tier', d.manualTier ?? 'Automatic'],
    ['Flag URL', d.flagUrl],
    ['Custom destination', String(d.custom)],
    ['Photo count', d.images.length],
    ...d.images.flatMap((image, i) =>
      Object.entries(image).map(([key, value]) => [`Photo ${i + 1} · ${key}`, String(value)]),
    ),
  ]);
}

export function changedFields(local, remote, kind) {
  const a = comparisonFields(local, kind),
    b = comparisonFields(remote, kind);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => a[key] !== b[key])
    .map((label) => ({ label, local: a[label] ?? 'None', remote: b[label] ?? 'None' }));
}
