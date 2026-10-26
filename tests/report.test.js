import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateCountry, rating, exportBackup, parseBackup } from '../src/model.js';
import { tripReport } from '../src/report.js';
import { sameContent, changedFields } from '../src/compare.js';
const scores = (n) =>
  Object.fromEntries(['wonder', 'things', 'food', 'transportation', 'safety'].map((k) => [k, n]));
const destination = () =>
  migrateCountry({
    name: 'Japan',
    id: 'japan',
    status: 'visited',
    profiles: {
      mike: { expected: { scores: scores(3) }, experienced: { scores: scores(5) } },
      jen: { expected: { scores: scores(5) }, experienced: { scores: scores(4) } },
    },
  });

test('legacy statuses migrate, while all four new states survive backups', () => {
  assert.equal(migrateCountry({ name: 'A', status: 'planning' }).status, 'planned');
  assert.equal(migrateCountry({ name: 'A', status: 'not-visited' }).status, 'idea');
  assert.equal(migrateCountry({ name: 'A' }).status, 'idea');
  for (const status of ['idea', 'planned', 'visited', 'revisit']) {
    const c = { ...destination(), status };
    assert.deepEqual(parseBackup(exportBackup([c]))[0], c);
    assert.equal(
      rating(c).phase,
      ['visited', 'revisit'].includes(status) ? 'experienced' : 'expected',
    );
  }
});
test('completed report compares both people, category scores, averages and disagreement', () => {
  const r = tripReport(destination());
  assert.equal(r.complete, true);
  assert.equal(r.people.mike.change, 10);
  assert.equal(r.people.jen.change, -5);
  assert.equal(r.people.mike.categories[0].change, 2);
  assert.equal(r.change, 2.5);
  assert.equal(r.before.disagreement, 10);
  assert.equal(r.after.disagreement, 5);
});
test('partial and pre-trip reports never treat missing scores as zero or call themselves complete', () => {
  const c = destination();
  c.profiles.jen.experienced.scores = null;
  const r = tripReport(c);
  assert.equal(r.complete, false);
  assert.equal(r.change, null);
  assert.equal(r.people.jen.change, null);
  assert.equal(r.people.jen.categories[0].change, null);
  assert.deepEqual(r.missing, [{ person: 'jen', phase: 'experienced' }]);
  assert.equal(tripReport({ ...destination(), status: 'planned' }).complete, false);
  assert.equal(tripReport({ ...destination(), status: 'revisit' }).complete, true);
});
test('identical content ignores timestamps, revisions, field order, and legacy status names', () => {
  const a = { ...destination(), status: 'planning' };
  const b = Object.fromEntries(
    Object.entries({ ...a, status: 'planned', _rev: 'other', updatedAt: 123 }).reverse(),
  );
  assert.equal(sameContent(a, b, 'meta'), true);
  assert.deepEqual(changedFields(a, b, 'meta'), []);
});
test('equal photo counts still show the actual changed photos and lock settings', () => {
  const a = destination(),
    b = destination();
  a.images = [{ src: 'https://example.com/one.jpg', alt: 'First', locked: false }];
  b.images = [{ src: 'https://example.com/two.jpg', alt: 'Second', locked: true }];
  assert.equal(sameContent(a, b, 'meta'), false);
  assert.deepEqual(
    changedFields(a, b, 'meta').map((r) => r.label),
    ['Photo 1 · src', 'Photo 1 · alt', 'Photo 1 · locked'],
  );
});
test('equal totals do not hide category differences or note differences', () => {
  const a = destination().profiles.mike,
    b = structuredClone(a);
  b.expected.scores.wonder++;
  b.expected.scores.food--;
  b.postNotes = 'Different trip';
  assert.equal(sameContent(a, b, 'profile'), false);
  assert.deepEqual(
    changedFields(a, b, 'profile').map((r) => r.label),
    ['Before · Wonder', 'Before · Food', 'After-trip notes'],
  );
});

test('empty score representations do not cause invisible profile conflicts', () => {
  const a = destination().profiles.mike,
    b = structuredClone(a);
  a.expected = { scores: null };
  b.expected = { scores: scores(null) };
  assert.equal(sameContent(a, b, 'profile'), true);
  assert.deepEqual(changedFields(a, b, 'profile'), []);
});
