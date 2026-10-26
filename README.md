# Travel Tiers

An Android app for Mike and Jen’s destination rankings, trip notes, photos, and budgets. The same source also runs on the web. Android bundles the complete interface inside the APK: no browser or hosted site is needed to open it.

## What’s included

- Offline device storage; a durable upload queue; retry and conflict resolution.
- Independent Mike/Jen profiles and expected/experienced ratings. Edit both profiles before saving.
- Average/Mike/Jen views, rating counts, disagreement sorting, status/tier filters, full-text search, and complete rating queues.
- Countries and custom destinations such as Antarctica or Svalbard.
- Structured budgets with currency, per-person/per-couple basis, and duration; legacy budgets remain visible.
- Draft recovery, JSON export/import, and the last ten recovery points. Resets retain notes.
- Pexels galleries with locks, cancellation, attribution, safe links, and no changes until Save.
- Email/password sign-in and deny-by-default Firestore membership rules.
- Android native back handling, safe-area layout, home-screen icon, splash screen, and native backup sharing.
- Optional installable web app with an offline shell and explicit update prompts.

## Run and test

Use Node 22+ and Java 21 for the Android build and Firestore emulator.

```sh
npm ci
npm run dev
npm test
npm run test:rules
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run test:rules` uses the **demo-travel-tierlist** emulator project, never production. Browser tests use local storage and fake photo responses, never the production list. `CHROME_PATH` can select an already-installed Chrome executable.

See [Android build and installation](docs/ANDROID.md) and [one-time private sync setup](docs/CLOUD_SETUP.md). Installing the app does not deploy Firebase rules or grant cloud access. The app works locally without either step.

## Data and synchronization

`src/model.js` validates and migrates data. `src/store.js` is the storage-independent state machine. `src/storage.js` uses Android Preferences in the APK and IndexedDB on the web. Both save the list, draft, recovery points, and pending operations together before confirming a save.

Firestore metadata lives at `countries/{id}`. Each profile has its own document at `countries/{id}/profiles/{mike|jen}`. Derived totals and averages are computed, not shared mutable fields. Every entity has an opaque `_rev`. Transactions compare the base revision before committing one entity; retries are idempotent. Conflicts keep both versions until the user chooses one. Metadata is sent before profiles so restoring a tombstoned destination can restore its ratings. Deletions are tombstones, preventing an old offline device from resurrecting a country silently.

The previous `travelTierListData` browser storage is imported on first launch on the same origin and retained as an exportable original archive. Legacy cloud maps migrate after an authorized server snapshot. Firebase cache-only snapshots cannot prune local records. Pending edits always take precedence locally until upload or explicit conflict resolution.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Model, durable store, cloud transport, photos, and interface |
| `android/` | Native Android app and Gradle wrapper |
| `tests/` | Model/store regressions, security rules, and browser integration |
| `firestore.rules` | Version-controlled membership and data validation rules |
| `.github/workflows/` | Tests, preview APKs, and signed APK builds |
| `docs/` | Installation, migration, signing, and backend setup |

No credentials, signing keys, or production exports belong in this repository. Firebase web configuration identifies the public project; the deployed rules enforce access.
