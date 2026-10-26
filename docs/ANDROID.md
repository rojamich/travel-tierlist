# Android installation and builds

## Install

Download the signed `travel-tiers.apk` to your Android phone, open it, and allow installation from that download source when Android asks. The app appears as **Travel Tiers** in your app drawer. It opens in its own window and works without a browser or connection. Android 7.0/API 24 or later is supported; keep Android System WebView updated.

Use Settings → Backup & recovery to export your list. Backups use the Android share sheet so you can save to Files or another location. Uninstalling the app can remove device-local data, including pending changes and recovery points. For updates, install an APK signed with the same key and a higher version code over the existing app; do not uninstall first.

## Development APK

Install Java 21, Android SDK Platform 36, and Build Tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` for your machine.

```sh
npm ci
npm run android:build
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. CI uploads this as **travel-tiers-android-preview**. Debug APKs are for testing and may be signed with different disposable keys on different machines. Use signed release APKs for ongoing use and updates.

## Signed release APK

Keep the release keystore and passwords private and backed up. A keystore is never committed. To create your own key:

```sh
keytool -genkeypair -keystore /private/path/travel-tiers.jks -alias travel-tiers \
  -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Travel Tiers"
```

Set these environment variables in your local build environment, without putting passwords in source files:

- `TRAVEL_TIERS_KEYSTORE`: absolute path to the keystore
- `TRAVEL_TIERS_STORE_PASSWORD`: keystore password
- `TRAVEL_TIERS_KEY_PASSWORD`: key password
- `TRAVEL_TIERS_KEY_ALIAS`: `travel-tiers`
- `TRAVEL_TIERS_VERSION_CODE`: a whole number higher than the installed version (initial release: `20000`)

```sh
npm run android:sync
cd android
./gradlew assembleRelease --no-daemon
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. Verify it with Android SDK Build Tools’ `apksigner verify --verbose` before distribution.

For repeatable GitHub builds, configure repository secrets `TRAVEL_TIERS_KEYSTORE_BASE64` (base64 of the same keystore), `TRAVEL_TIERS_STORE_PASSWORD`, and `TRAVEL_TIERS_KEY_PASSWORD`. Run **Signed Android APK** from Actions and enter an increasing version code. The workflow uploads an installable signed artifact and deletes its temporary keystore. It does not publish to Google Play or deploy Firebase.

## Native project

The web bundle is copied inside the APK by `cap sync android`; the app does not load a remote website. Export uses native Filesystem and Share plugins; Preferences stores the durable list. The hardware back button closes dialogs, returns to the board, then minimizes the app. Native builds do not register a service worker. Firebase email/password authentication works through the bundled JavaScript SDK and does not require OAuth redirects or a `google-services.json` file.

The root Vite build remains usable for GitHub Pages. `.github/workflows/pages.yml` builds and publishes only `dist/`, including the compiled JavaScript, styles, icons, manifest, and service worker. In repository Settings → Pages → Build and deployment, set **Source** to **GitHub Actions**. Publishing the repository root directly serves uncompiled source and breaks the website. `scripts/verify-pages-build.mjs` checks every local HTML asset against the `/travel-tierlist/` project URL before deployment.
