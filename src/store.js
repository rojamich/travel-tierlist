import {
  clone,
  uid,
  PROFILE_KEYS,
  cleanMeta,
  cleanProfile,
  migrateCountry,
  normalizeName,
  exportBackup,
  isDestinationId,
} from './model.js';
import { sameContent } from './compare.js';

const blankState = () => ({
  version: 3,
  records: {},
  pending: {},
  history: [],
  draft: null,
  syncOwner: null,
});
export const metaKey = (id) => `${id}/meta`;
export const profileKey = (id, key) => `${id}/profiles/${key}`;
const emptyEntry = () => ({ meta: null, profiles: {} });

function readEntity(state, operation) {
  const entry = state.records[operation.countryId];
  return operation.kind === 'meta' ? entry?.meta : entry?.profiles[operation.profile];
}
function writeEntity(state, operation, entity) {
  const entry = (state.records[operation.countryId] ||= emptyEntry());
  if (operation.kind === 'meta') entry.meta = entity;
  else entry.profiles[operation.profile] = entity;
}
function enqueue(state, id, kind, data, profile, baseRevision) {
  const key = kind === 'meta' ? metaKey(id) : profileKey(id, profile);
  const previous = state.pending[key];
  const revision = uid();
  const operation = {
    key,
    countryId: id,
    kind,
    profile: profile || null,
    data: clone(data),
    revision,
    baseRevision: previous ? previous.baseRevision : (baseRevision ?? null),
    createdAt: new Date().toISOString(),
    conflict: null,
  };
  state.pending[key] = operation;
  writeEntity(state, operation, { data: clone(data), revision });
}

function backup(state, label) {
  state.history.unshift({
    id: uid(),
    createdAt: new Date().toISOString(),
    label,
    records: clone(state.records),
  });
  state.history = state.history.slice(0, 10);
}

function project(records) {
  return Object.entries(records)
    .filter(([, entry]) => entry.meta && !entry.meta.data.deleted)
    .map(([id, entry]) => ({
      id,
      ...cleanMeta(entry.meta.data),
      profiles: Object.fromEntries(
        PROFILE_KEYS.map((key) => [
          key,
          cleanProfile(entry.profiles[key]?.data, entry.meta.data.status),
        ]),
      ),
    }));
}

export class TravelStore {
  constructor(storage) {
    this.storage = storage;
    this.state = blankState();
    this.listeners = new Set();
    this.tail = Promise.resolve();
  }
  async init(legacy) {
    const saved = await this.storage.load();
    this.state = saved || blankState();
    if (this.state.version !== 3)
      throw new Error('This data was made by a newer app. Update Travel Tiers before opening it.');
    if (!saved && Array.isArray(legacy) && legacy.length) {
      const converted = [];
      for (const country of legacy) {
        try {
          converted.push(migrateCountry(country));
        } catch {
          /* Preserve unconvertible entries in the original archive below. */
        }
      }
      await this.importCountries(converted, 'merge', 'Before importing the previous app');
      await this.mutate((state) => {
        state.legacyArchive = clone(legacy);
        state.migrationWarnings = legacy.length - converted.length;
      });
    }
    if (!saved) await this.storage.save(this.state);
    return this;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  mutate(callback) {
    const change = this.tail.then(async () => {
      const next = clone(this.state);
      await callback(next);
      await this.storage.save(next);
      this.state = next;
      for (const listener of this.listeners) listener();
    });
    this.tail = change.catch(() => {});
    return change;
  }
  get countries() {
    return project(this.state.records);
  }
  get pending() {
    return Object.values(this.state.pending);
  }
  get conflicts() {
    return this.pending.filter((op) => op.conflict);
  }
  entity(id) {
    return clone(this.state.records[id] || emptyEntry());
  }
  async saveCountry(country, base = emptyEntry(), dirty = { meta: true, profiles: PROFILE_KEYS }) {
    const meta = cleanMeta(country);
    const profiles = Object.fromEntries(
      PROFILE_KEYS.map((key) => [key, cleanProfile(country.profiles?.[key], meta.status)]),
    );
    const id = country.id || `destination-${uid()}`;
    if (!isDestinationId(id))
      throw new Error('Invalid destination ID. Import this entry through a backup to repair it.');
    await this.mutate((state) => {
      const duplicate = project(state.records).find(
        (c) => c.id !== id && normalizeName(c.name) === normalizeName(meta.name),
      );
      if (duplicate)
        throw new Error('That destination already exists. Open it to edit its ratings.');
      if (dirty.meta) enqueue(state, id, 'meta', meta, null, base.meta?.revision);
      for (const key of dirty.profiles)
        enqueue(state, id, 'profile', profiles[key], key, base.profiles[key]?.revision);
      state.draft = null;
    });
    return id;
  }
  async deleteCountry(id) {
    await this.mutate((state) => {
      const entry = state.records[id];
      if (!entry?.meta) return;
      backup(state, `Before deleting ${entry.meta.data.name}`);
      enqueue(state, id, 'meta', { ...entry.meta.data, deleted: true }, null, entry.meta.revision);
      for (const key of PROFILE_KEYS) delete state.pending[profileKey(id, key)];
      state.draft = null;
    });
  }
  async resetCountry(id) {
    const country = this.countries.find((c) => c.id === id);
    if (!country) return;
    await this.mutate((state) => {
      backup(state, `Before clearing ${country.name}'s ratings`);
      const entry = state.records[id];
      enqueue(
        state,
        id,
        'meta',
        { ...entry.meta.data, manualTier: null },
        null,
        entry.meta.revision,
      );
      for (const key of PROFILE_KEYS) {
        const profile = cleanProfile(entry.profiles[key]?.data, country.status);
        profile.expected = { scores: null };
        profile.experienced = { scores: null };
        enqueue(state, id, 'profile', profile, key, entry.profiles[key]?.revision);
      }
      state.draft = null;
    });
  }
  async importCountries(countries, mode = 'merge', label = 'Before importing a backup') {
    const validated = countries.map(migrateCountry);
    await this.mutate((state) => {
      backup(state, label);
      const current = project(state.records);
      const retained = new Set();
      for (const country of validated) {
        const existing = current.find((c) => normalizeName(c.name) === normalizeName(country.name));
        let id = existing?.id || country.id;
        if (
          !existing &&
          state.records[id]?.meta &&
          normalizeName(state.records[id].meta.data.name) !== normalizeName(country.name)
        )
          id = `destination-${uid()}`;
        retained.add(id);
        const entry = state.records[id];
        enqueue(state, id, 'meta', cleanMeta(country), null, entry?.meta?.revision);
        for (const key of PROFILE_KEYS)
          enqueue(
            state,
            id,
            'profile',
            cleanProfile(country.profiles[key], country.status),
            key,
            entry?.profiles[key]?.revision,
          );
      }
      if (mode === 'replace')
        for (const country of current)
          if (!retained.has(country.id)) {
            const entry = state.records[country.id];
            enqueue(
              state,
              country.id,
              'meta',
              { ...entry.meta.data, deleted: true },
              null,
              entry.meta.revision,
            );
            for (const key of PROFILE_KEYS) delete state.pending[profileKey(country.id, key)];
          }
      state.draft = null;
    });
  }
  async restore(id) {
    const recovery = this.state.history.find((item) => item.id === id);
    if (!recovery) throw new Error('That recovery point is no longer available.');
    await this.importCountries(
      project(recovery.records),
      'replace',
      'Before restoring a recovery point',
    );
  }
  async saveDraft(draft) {
    await this.mutate((state) => {
      state.draft = clone(draft);
    });
  }
  async clearDraft() {
    if (this.state.draft) await this.saveDraft(null);
  }
  export() {
    return exportBackup(this.countries);
  }
  async claimSyncOwner(userId) {
    // A sign-in change must never upload the previous account's private local copy.
    if (this.state.syncOwner && this.state.syncOwner !== userId)
      throw new Error(
        'This device contains another account’s list. Export it, then clear this device before changing accounts.',
      );
    await this.mutate((state) => {
      state.syncOwner = userId;
    });
  }
  async clearDevice() {
    await this.mutate((state) => {
      Object.assign(state, blankState());
    });
  }
  async acceptRemote(id, kind, profile, data, revision) {
    if (!isDestinationId(id)) return;
    const operation = {
      countryId: id,
      kind,
      profile,
      key: kind === 'meta' ? metaKey(id) : profileKey(id, profile),
    };
    const normalized = kind === 'meta' ? cleanMeta(data) : cleanProfile(data);
    await this.mutate((state) => {
      const pending = state.pending[operation.key];
      if (pending) {
        if (!sameContent(pending.data, normalized, kind)) {
          if (pending.conflict)
            pending.conflict.remote = { data: normalized, revision: revision || null };
          return;
        }
        delete state.pending[operation.key];
      }
      writeEntity(state, operation, { data: normalized, revision: revision || null });
    });
  }
  async acceptMetaSnapshot(documents) {
    await this.mutate((state) => {
      const oldDocuments = documents.filter((doc) => doc.data.schemaVersion !== 3);
      if (oldDocuments.length) {
        const archive = (state.legacyCloudArchive ||= []);
        for (const doc of oldDocuments)
          if (!archive.some((item) => item.id === doc.id)) archive.push(clone(doc));
      }
      const remoteIds = new Set(documents.map((doc) => doc.id));
      for (const [id, entry] of Object.entries(state.records)) {
        const hasPending = Object.values(state.pending).some((op) => op.countryId === id);
        if (!remoteIds.has(id) && !hasPending) delete state.records[id];
      }
      for (const doc of documents) {
        if (!isDestinationId(doc.id)) {
          state.migrationWarnings = (state.migrationWarnings || 0) + 1;
          continue;
        }
        let meta;
        try {
          meta = cleanMeta(doc.data);
        } catch {
          state.migrationWarnings = (state.legacyCloudArchive || []).filter(
            (item) => !item.data.name,
          ).length;
          continue;
        }
        const pending = state.pending[metaKey(doc.id)];
        if (pending) {
          if (!sameContent(pending.data, meta, 'meta')) {
            if (pending.conflict)
              pending.conflict.remote = { data: meta, revision: doc.revision || null };
            continue;
          }
          delete state.pending[metaKey(doc.id)];
        }
        const entry = (state.records[doc.id] ||= emptyEntry());
        entry.meta = { data: meta, revision: doc.revision || null };
        if (doc.data.schemaVersion !== 3) {
          // Upgrade legacy profile maps through the same durable, revision-checked queue.
          if (!state.history.some((h) => h.label === 'Before upgrading cloud data'))
            backup(state, 'Before upgrading cloud data');
          for (const key of PROFILE_KEYS)
            if (!state.pending[profileKey(doc.id, key)] && !entry.profiles[key]?.revision) {
              const raw = doc.data.profiles?.[key] || (key === 'mike' ? doc.data : {});
              enqueue(state, doc.id, 'profile', cleanProfile(raw, meta.status), key, null);
            }
          enqueue(state, doc.id, 'meta', meta, null, doc.revision);
        }
      }
    });
  }
  async acknowledge(operation, revision = operation.revision) {
    await this.mutate((state) => {
      const current = state.pending[operation.key];
      if (!current) return;
      if (current.revision === operation.revision) {
        delete state.pending[operation.key];
        const entity = readEntity(state, operation);
        if (entity?.revision === operation.revision) entity.revision = revision;
      } else {
        current.baseRevision = revision;
        current.conflict = null;
      }
    });
  }
  async markConflict(operation, remote, reason = 'changed') {
    await this.mutate((state) => {
      const current = state.pending[operation.key];
      if (current && current.revision === operation.revision) {
        if (
          reason !== 'deleted-country' &&
          remote &&
          sameContent(current.data, remote.data, current.kind)
        ) {
          writeEntity(state, current, clone(remote));
          delete state.pending[operation.key];
        } else current.conflict = { remote: clone(remote), reason };
      }
    });
  }
  async resolveConflict(key, choice) {
    await this.mutate((state) => {
      const operation = state.pending[key];
      if (!operation?.conflict) return;
      backup(state, 'Before resolving a sync conflict');
      const remote = operation.conflict.remote;
      if (choice === 'remote') {
        if (remote) writeEntity(state, operation, clone(remote));
        else if (operation.kind === 'profile')
          delete state.records[operation.countryId]?.profiles[operation.profile];
        else delete state.records[operation.countryId];
        delete state.pending[key];
      } else {
        if (operation.conflict.reason === 'deleted-country')
          throw new Error(
            'This destination was deleted on another device. Restore it from a recovery point to add it again.',
          );
        operation.baseRevision = remote?.revision || null;
        operation.conflict = null;
        operation.revision = uid();
        writeEntity(state, operation, {
          data: clone(operation.data),
          revision: operation.revision,
        });
      }
    });
  }
  async reconcileIdenticalConflicts() {
    if (
      !this.conflicts.some(
        (op) =>
          op.conflict.reason !== 'deleted-country' &&
          op.conflict.remote &&
          sameContent(op.data, op.conflict.remote.data, op.kind),
      )
    )
      return;
    await this.mutate((state) => {
      for (const op of Object.values(state.pending)) {
        const remote = op.conflict?.remote;
        if (
          remote &&
          op.conflict.reason !== 'deleted-country' &&
          sameContent(op.data, remote.data, op.kind)
        ) {
          writeEntity(state, op, clone(remote));
          delete state.pending[op.key];
        }
      }
    });
  }
}

// The transport commits one entity with optimistic concurrency. It must never write an entire shared profile map.
export class SyncQueue {
  constructor(store, transport, onStatus = () => {}) {
    this.store = store;
    this.transport = transport;
    this.onStatus = onStatus;
    this.running = false;
    this.active = true;
  }
  stop() {
    this.active = false;
  }
  flush() {
    if (!this.active) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  async drain() {
    this.running = true;
    try {
      while (this.active) {
        const next = this.store.pending
          .filter((op) => !op.conflict)
          .sort((a, b) => Number(a.kind !== 'meta') - Number(b.kind !== 'meta'))[0];
        if (!next) break;
        this.onStatus('syncing');
        try {
          const result = await this.transport.commit(clone(next));
          if (result.conflict) await this.store.markConflict(next, result.remote, result.reason);
          else await this.store.acknowledge(next, result.revision ?? next.revision);
        } catch (error) {
          this.onStatus('error', error);
          return;
        }
      }
      if (!this.active) return;
      this.onStatus(
        this.store.conflicts.length ? 'conflict' : this.store.pending.length ? 'pending' : 'synced',
      );
    } finally {
      this.running = false;
    }
  }
}
