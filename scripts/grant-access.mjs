import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const email=process.argv[2];
if(!email || !email.includes('@')) { console.error('Usage: npm run cloud:member -- user@example.com');process.exit(1); }
initializeApp({credential:applicationDefault(),projectId:'travel-tiers'});
const user=await getAuth().getUserByEmail(email);
await getFirestore().collection('members').doc(user.uid).set({grantedAt:FieldValue.serverTimestamp()});
console.log('Shared-list access granted. The user must verify their email before syncing.');
