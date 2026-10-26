import test from 'node:test';
import assert from 'node:assert/strict';
import { TravelStore, SyncQueue, metaKey, profileKey } from '../src/store.js';
import { clone, migrateCountry, rating, emptyProfile } from '../src/model.js';

const scores = (value) => ({
  wonder: value,
  things: value,
  food: value,
  transportation: value,
  safety: value,
});
const fixture = (name = 'Japan') =>
  migrateCountry({
    id: name.toLowerCase(),
    name,
    status: 'visited',
    profiles: {
      mike: { scores: scores(4), notes: 'Mike' },
      jen: { scores: scores(5), notes: 'Jen' },
    },
  });
function memory() {
  return {
    value: null,
    fail: false,
    async load() {
      return clone(this.value);
    },
    async save(state) {
      if (this.fail) throw new Error('Storage full');
      this.value = clone(state);
    },
  };
}
async function setup() {
  const storage = memory(),
    store = await new TravelStore(storage).init();
  return { store, storage };
}
function transport() {
  const entities = new Map();
  return {
    entities,
    async commit(op) {
      const remote = entities.get(op.key);
      if (remote?.revision === op.revision) return { ok: true };
      if ((remote?.revision || null) !== op.baseRevision)
        return { conflict: true, remote: remote || null };
      entities.set(op.key, { data: clone(op.data), revision: op.revision });
      return { ok: true };
    },
  };
}

test('both profile drafts are saved together and survive a restart', async () => {
  const { store, storage } = await setup();
  const c = fixture();
  c.profiles.mike.notes = 'New Mike';
  c.profiles.jen.notes = 'New Jen';
  await store.saveCountry(c);
  const reloaded = await new TravelStore(storage).init();
  assert.equal(reloaded.countries[0].profiles.mike.notes, 'New Mike');
  assert.equal(reloaded.countries[0].profiles.jen.notes, 'New Jen');
  assert.equal(reloaded.pending.length, 3);
});
test('a storage failure leaves the last durable state untouched', async () => {
  const { store, storage } = await setup();
  await store.saveCountry(fixture());
  const previous = clone(store.state);
  storage.fail = true;
  await assert.rejects(() => store.deleteCountry('japan'), /Storage full/);
  assert.deepEqual(store.state, previous);
});
test('remote snapshots are durably cached, including the empty collection', async () => {
  const { store, storage } = await setup();
  await store.acceptMetaSnapshot([{ id: 'japan', data: fixture(), revision: 'r1' }]);
  assert.equal((await new TravelStore(storage).init()).countries.length, 1);
  await store.acceptMetaSnapshot([]);
  assert.equal((await new TravelStore(storage).init()).countries.length, 0);
});
test('pending new destinations survive unrelated snapshots and restart', async () => {
  const { store, storage } = await setup();
  await store.saveCountry(fixture());
  await store.acceptMetaSnapshot([]);
  assert.equal(store.countries.length, 1);
  assert.equal((await new TravelStore(storage).init()).pending.length, 3);
});
test('failed uploads retain the queue and successful retries drain it', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  let fail = true;
  const remote = transport(),
    states = [];
  const queue = new SyncQueue(
    store,
    {
      async commit(op) {
        if (fail) throw new Error('offline');
        return remote.commit(op);
      },
    },
    (state) => states.push(state),
  );
  await queue.flush();
  assert.equal(store.pending.length, 3);
  assert.equal(states.at(-1), 'error');
  fail = false;
  await queue.flush();
  assert.equal(store.pending.length, 0);
  assert.equal(states.at(-1), 'synced');
});
test('one profile upload never includes or overwrites the other profile', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const remote = transport();
  await new SyncQueue(store, remote).flush();
  const before = clone(remote.entities.get(profileKey('japan', 'jen')));
  const c = store.countries[0];
  c.profiles.mike.notes = 'Changed Mike';
  await store.saveCountry(c, store.entity('japan'), { meta: false, profiles: ['mike'] });
  await new SyncQueue(store, remote).flush();
  assert.deepEqual(remote.entities.get(profileKey('japan', 'jen')), before);
  assert.equal(remote.entities.get(profileKey('japan', 'mike')).data.notes, 'Changed Mike');
});
test('newer remote clears replace complete local ratings without backfill', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await new SyncQueue(store, transport()).flush();
  await store.acceptRemote('japan', 'profile', 'mike', emptyProfile(), 'remote-reset');
  assert.equal(rating(store.countries[0], 'mike').score, null);
  assert.equal(store.pending.length, 0);
});
test('explicit clearing removes every score and stale automatic tier', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const c = store.countries[0];
  for (const key of ['mike', 'jen']) c.profiles[key] = emptyProfile();
  await store.saveCountry(c, store.entity('japan'));
  assert.equal(rating(store.countries[0]).score, null);
  assert.equal(rating(store.countries[0]).tier, 'unranked');
});
test('reset preserves notes and creates a restorable recovery point', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await store.resetCountry('japan');
  assert.equal(rating(store.countries[0]).score, null);
  assert.equal(store.countries[0].profiles.mike.notes, 'Mike');
  await store.restore(store.state.history[0].id);
  assert.equal(rating(store.countries[0]).score, 22.5);
});
test('deletions use tombstones, retain recovery, and remove pending profiles', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await store.deleteCountry('japan');
  assert.equal(store.countries.length, 0);
  assert.equal(store.pending.length, 1);
  assert.equal(store.pending[0].data.deleted, true);
  assert.equal(store.state.history.length, 1);
  await store.restore(store.state.history[0].id);
  assert.equal(store.countries.length, 1);
});
test('merge import preserves other entries and replace import tombstones them', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await store.importCountries([fixture('Italy')], 'merge');
  assert.equal(store.countries.length, 2);
  await store.importCountries([fixture('Peru')], 'replace');
  assert.deepEqual(
    store.countries.map((c) => c.name),
    ['Peru'],
  );
  assert.equal(store.state.history.length, 2);
});
test('invalid imports do not mutate data or recovery history', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const previous = clone(store.state);
  await assert.rejects(() => store.importCountries([{ name: 'Bad', scores: scores(9) }]));
  assert.deepEqual(store.state, previous);
});
test('case-normalized duplicate destination names are rejected', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await assert.rejects(
    () => store.saveCountry({ ...fixture(), id: 'different', name: 'JAPAN' }),
    /already exists/,
  );
});
test('conflicts retain local data until the user chooses a version', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const remote = transport();
  remote.entities.set(metaKey('japan'), {
    data: { ...fixture(), bestTime: 'April' },
    revision: 'someone-else',
  });
  await new SyncQueue(store, remote).flush();
  assert.equal(store.conflicts.length, 1);
  assert.equal(store.countries[0].name, 'Japan');
  await store.resolveConflict(metaKey('japan'), 'local');
  await new SyncQueue(store, remote).flush();
  assert.equal(store.conflicts.length, 0);
  assert.equal(store.pending.length, 0);
  assert.ok(store.state.history.length);
});
test('a pending edit made during an upload is retained with the acknowledged base revision', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const remote = transport();
  await new SyncQueue(store, remote).flush();
  const c = store.countries[0];
  c.profiles.mike.notes = 'First edit';
  await store.saveCountry(c, store.entity('japan'), { meta: false, profiles: ['mike'] });
  const operation = clone(store.pending[0]);
  c.profiles.mike.notes = 'Second edit';
  await store.saveCountry(c, store.entity('japan'), { meta: false, profiles: ['mike'] });
  await remote.commit(operation);
  await store.acknowledge(operation);
  assert.equal(store.pending[0].baseRevision, operation.revision);
  assert.equal(store.countries[0].profiles.mike.notes, 'Second edit');
  await new SyncQueue(store, remote).flush();
  assert.equal(remote.entities.get(operation.key).data.notes, 'Second edit');
});
test('repeating an acknowledged operation is idempotent', async () => {
  const remote = transport();
  const operation = { key: 'japan/meta', data: fixture(), baseRevision: null, revision: 'unique' };
  assert.deepEqual(await remote.commit(operation), { ok: true });
  assert.deepEqual(await remote.commit(operation), { ok: true });
});
test('legacy local data is archived and migration is not repeated', async () => {
  const storage = memory();
  let store = await new TravelStore(storage).init([fixture()]);
  assert.equal(store.countries.length, 1);
  assert.ok(store.state.legacyArchive);
  store = await new TravelStore(storage).init([fixture('Italy')]);
  assert.deepEqual(
    store.countries.map((c) => c.name),
    ['Japan'],
  );
});
test('cloud legacy profiles migrate into independent nested profile documents', async () => {
  const { store } = await setup();
  await store.acceptMetaSnapshot([
    {
      id: 'japan',
      data: { name: 'Japan', status: 'visited', profiles: { mike: { scores: scores(4) } } },
      revision: null,
    },
  ]);
  assert.equal(store.pending.length, 3);
  assert.equal(rating(store.countries[0], 'mike').score, 20);
});
test('drafts are saved independently from committed destinations', async () => {
  const { store, storage } = await setup();
  await store.saveDraft({ country: { name: 'Antarctica' } });
  const reloaded = await new TravelStore(storage).init();
  assert.equal(reloaded.state.draft.country.name, 'Antarctica');
  assert.equal(reloaded.countries.length, 0);
  await reloaded.clearDraft();
  assert.equal(reloaded.state.draft, null);
});
test('account changes cannot silently upload a previous account’s local copy', async () => {
  const { store } = await setup();
  await store.claimSyncOwner('mike');
  await assert.rejects(() => store.claimSyncOwner('someone-else'), /another account/);
});
test('an intentional device clear does not reimport old browser storage', async () => {
  const storage = memory();
  const store = await new TravelStore(storage).init([fixture()]);
  await store.clearDevice();
  const reloaded = await new TravelStore(storage).init([fixture()]);
  assert.equal(reloaded.countries.length, 0);
});
test('malformed legacy entries are archived without blocking valid destinations', async () => {
  const storage = memory();
  const store = await new TravelStore(storage).init([fixture(), { broken: true }]);
  assert.equal(store.countries.length, 1);
  assert.equal(store.state.legacyArchive.length, 2);
  assert.equal(store.state.migrationWarnings, 1);
});
test('restores sync metadata before profiles so tombstones can be restored', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const order = [];
  await new SyncQueue(store, {
    async commit(op) {
      order.push(op.kind);
      return { ok: true };
    },
  }).flush();
  assert.equal(order[0], 'meta');
});

test('identical conflicts clear automatically and retain the remote revision for later edits', async () => {
  const { store, storage } = await setup();
  await store.saveCountry(fixture());
  const op = store.pending.find((op) => op.kind === 'meta');
  await store.markConflict(op, { data: { ...op.data, _rev: 'remote' }, revision: 'remote' });
  assert.equal(store.conflicts.length, 0);
  assert.equal(store.entity('japan').meta.revision, 'remote');
  const copy = await new TravelStore(storage).init();
  assert.equal(copy.entity('japan').meta.revision, 'remote');
  const c = copy.countries[0];
  c.bestTime = 'May';
  await copy.saveCountry(c, copy.entity(c.id), { meta: true, profiles: [] });
  assert.equal(copy.pending.find((op) => op.kind === 'meta').baseRevision, 'remote');
});
test('snapshots reconcile matching pending metadata and profiles without losing real changes', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  await store.acceptMetaSnapshot([{ id: 'japan', data: fixture(), revision: 'remote-meta' }]);
  assert.equal(
    store.pending.some((op) => op.kind === 'meta'),
    false,
  );
  const mike = store.countries[0].profiles.mike;
  await store.acceptRemote('japan', 'profile', 'mike', mike, 'remote-mike');
  assert.equal(
    store.pending.some((op) => op.profile === 'mike'),
    false,
  );
  assert.equal(store.entity('japan').profiles.mike.revision, 'remote-mike');
  await store.acceptRemote(
    'japan',
    'profile',
    'jen',
    { ...store.countries[0].profiles.jen, notes: 'Other device' },
    'remote-jen',
  );
  assert.equal(
    store.pending.some((op) => op.profile === 'jen'),
    true,
  );
  assert.equal(store.countries[0].profiles.jen.notes, 'Jen');
});
test('persisted identical conflicts from earlier versions reconcile on startup', async () => {
  const { store, storage } = await setup();
  await store.saveCountry(fixture());
  await store.mutate((state) => {
    const op = state.pending[metaKey('japan')];
    op.conflict = {
      reason: 'changed',
      remote: { data: clone(op.data), revision: 'already-shared' },
    };
  });
  const reloaded = await new TravelStore(storage).init();
  await reloaded.reconcileIdenticalConflicts();
  assert.equal(reloaded.conflicts.length, 0);
  assert.equal(reloaded.entity('japan').meta.revision, 'already-shared');
});
test('a conflict response for an older edit cannot attach to a newer local edit', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const old = clone(store.pending[0]);
  const c = store.countries[0];
  c.bestTime = 'New edit';
  await store.saveCountry(c, store.entity(c.id), { meta: true, profiles: [] });
  await store.markConflict(old, {
    data: { ...old.data, bestTime: 'Other edit' },
    revision: 'remote',
  });
  assert.equal(store.conflicts.length, 0);
  assert.equal(store.countries[0].bestTime, 'New edit');
});
test('equivalent remote acknowledgments rebase edits made while uploading', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  const old = clone(store.pending.find((op) => op.kind === 'meta'));
  const c = store.countries[0];
  c.bestTime = 'Next edit';
  await store.saveCountry(c, store.entity(c.id), { meta: true, profiles: [] });
  await store.acknowledge(old, 'equivalent-remote-revision');
  assert.equal(
    store.pending.find((op) => op.kind === 'meta').baseRevision,
    'equivalent-remote-revision',
  );
  assert.equal(store.countries[0].bestTime, 'Next edit');
});

test('repeated sync requests wait for the same upload instead of reporting early completion', async () => {
  const { store } = await setup();
  await store.saveCountry(fixture());
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queue = new SyncQueue(store, {
    async commit() {
      calls++;
      await gate;
      return { ok: true };
    },
  });
  const first = queue.flush();
  const second = queue.flush();
  assert.equal(first, second);
  let done = false;
  void second.then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(calls, 1);
  release();
  await second;
  assert.equal(store.pending.length, 0);
  assert.equal(calls, 3);
});
