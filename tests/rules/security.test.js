import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { cleanMeta, cleanProfile } from '../../src/model.js';
let env;
const meta = () => ({ ...cleanMeta({ name: 'Japan' }), _rev: 'r1', updatedAt: serverTimestamp() });
const profile = () => ({ ...cleanProfile(), _rev: 'p1', updatedAt: serverTimestamp() });
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-travel-tierlist',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', 'allowed'), { granted: true });
  });
});
const allowed = () =>
  env
    .authenticatedContext('allowed', { email: 'person@example.com', email_verified: true })
    .firestore();
test('anonymous users cannot read or write the shared collection', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(db, 'countries')));
  await assertFails(setDoc(doc(db, 'countries', 'japan'), meta()));
});
test('signed-in outsiders cannot access the list or grant themselves membership', async () => {
  const db = env.authenticatedContext('outsider', { email_verified: true }).firestore();
  await assertFails(getDocs(collection(db, 'countries')));
  await assertFails(setDoc(doc(db, 'members', 'outsider'), {}));
});
test('membership requires a verified email', async () => {
  const db = env.authenticatedContext('allowed', { email_verified: false }).firestore();
  await assertFails(setDoc(doc(db, 'countries', 'japan'), meta()));
});
test('members can read and write valid metadata and both independent profiles', async () => {
  const db = allowed();
  await assertSucceeds(setDoc(doc(db, 'countries', 'japan'), meta()));
  for (const key of ['mike', 'jen'])
    await assertSucceeds(setDoc(doc(db, 'countries', 'japan', 'profiles', key), profile()));
  await assertSucceeds(getDocs(collection(db, 'countries')));
  await assertSucceeds(getDoc(doc(db, 'countries', 'japan', 'profiles', 'mike')));
});
test('literal dotted fields, unknown profiles, and invalid scores are rejected', async () => {
  const db = allowed();
  await assertFails(
    setDoc(doc(db, 'countries', 'japan'), { ...meta(), 'profiles.mike': profile() }),
  );
  await assertFails(setDoc(doc(db, 'countries', 'japan', 'profiles', 'stranger'), profile()));
  const bad = profile();
  bad.expected.scores = { wonder: 9, things: 5, food: 5, transportation: 5, safety: 5 };
  await assertFails(setDoc(doc(db, 'countries', 'japan', 'profiles', 'mike'), bad));
});
test('destructive deletes are denied and tombstones stop stale profile writes', async () => {
  const db = allowed();
  await assertSucceeds(setDoc(doc(db, 'countries', 'japan'), meta()));
  await assertFails(deleteDoc(doc(db, 'countries', 'japan')));
  await assertSucceeds(setDoc(doc(db, 'countries', 'japan'), { ...meta(), deleted: true }));
  await assertFails(setDoc(doc(db, 'countries', 'japan', 'profiles', 'mike'), profile()));
});
test('client timestamps and unsafe media URLs are rejected', async () => {
  const db = allowed();
  await assertFails(setDoc(doc(db, 'countries', 'japan'), { ...meta(), updatedAt: 'fake' }));
  await assertFails(
    setDoc(doc(db, 'countries', 'japan'), { ...meta(), flagUrl: 'javascript:alert(1)' }),
  );
});
test('legacy documents can be replaced with the validated v3 schema', async () => {
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'countries', 'japan'), {
      name: 'Japan',
      profiles: { mike: { notes: 'legacy' } },
    }),
  );
  await assertSucceeds(setDoc(doc(allowed(), 'countries', 'japan'), meta()));
});
