# Private shared sync

The Android app works offline immediately. This one-time owner setup enables the existing Firebase project to sync privately. It requires Firebase console/admin access; GitHub access alone cannot deploy these settings.

## Set up the two accounts in the Firebase console

Enabling a sign-in provider does not create accounts or grant access to the list. You do not need to add email addresses to the app's source code.

1. In the app's **Settings**, use **Create account** with each person's email and password. Follow the verification email, then tap **I've verified my email**. If the accounts already exist, sign in with them instead.
2. In Firebase console → **Authentication → Users**, open each user and copy their **User UID**.
3. In **Firestore Database → Data**, create a collection named **members**. For each person, add a document whose **Document ID is exactly their User UID**, with a boolean field **granted = true**. Use the UID, not the email address, as the document ID. Both documents belong in the same `members` collection.
4. Back up existing data, then go to **Firestore Database → Rules**, paste the complete contents of [`firestore.rules`](../firestore.rules), and click **Publish**. Provider settings alone do not apply these database rules.
5. Sign in on both phones and use **Sync now**.

Google can remain enabled in Firebase, but the current app uses email/password sign-in. Enabling Google in the console does not add a Google sign-in button to the app.

## Administrator commands and migration

1. **Back up the existing Firestore `countries` collection before deploying.** Keep the old app available until you have verified the migrated list. An admin export script is provided below.
2. In Firebase console → Authentication → Sign-in method, enable **Email/Password** for project `travel-tiers`.
3. Create an account for each person through the app and follow the verification email. Signing in alone does not grant list access.
4. Using trusted local application-default credentials for this Firebase project, grant each account membership:

   ```sh
   npm run cloud:member -- person@example.com
   ```

   Alternatively use Firebase console → Firestore to create `members/{AUTHENTICATION_USER_UID}` with a simple `granted: true` field. Only a project administrator can add members; clients cannot grant themselves access. The document’s existence grants access, so delete it to revoke access.

5. Authenticate the Firebase CLI as the owner, review `firestore.rules`, then deploy:

   ```sh
   npx firebase login
   npm run cloud:deploy
   ```

6. Sign in on the first phone. The app reads and converts existing root profile maps into independent profile documents, preserving ratings and notes. Wait for **All changes synced**, inspect both people’s ratings and export an app backup. Then sign in on the second phone.

The previous browser app has no sign-in flow and will no longer have cloud access once the private rules are deployed. Stop editing the old version after migration. A new Android installation cannot read another browser’s local storage; legacy browser-only changes must be imported from a JSON backup, or synced by the previous app before the rules change.

## Administrator backup

Set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account file **outside the repository**, then run:

```sh
node scripts/backup-cloud.mjs /absolute/private/path/travel-tiers.backup.json
```

The output is a raw administrator archive including profile subcollections. It is separate from user-facing app backups and should be kept private. The script is read-only.

## Permissions

All list access requires a verified Firebase account with a `members/{uid}` document. Rules reject anonymous users, nonmembers, malformed profiles, invalid score values, unexpected fields, non-HTTPS media, client timestamps, and hard deletes. Recovery points and drafts remain device-local. Photo API keys are device-local and excluded from app exports and Firestore writes.

No production configuration or database change is performed by CI, app installation, or the test suite. Do not leave old permissive rules in place: deploy the reviewed rules before relying on private sync.
