import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {writeFile} from 'node:fs/promises';

const path=process.argv[2];if(!path){console.error('Supply an absolute private output path outside the repository.');process.exit(1);}
initializeApp({credential:applicationDefault(),projectId:'travel-tiers'});
const snapshot=await getFirestore().collection('countries').get();
const countries=[];
for(const entry of snapshot.docs){const profiles=await entry.ref.collection('profiles').get();countries.push({id:entry.id,data:entry.data(),profileDocuments:profiles.docs.map(p=>({id:p.id,data:p.data()}))});}
await writeFile(path,JSON.stringify({format:'travel-tiers-admin-archive',exportedAt:new Date().toISOString(),countries},null,2),{flag:'wx',mode:0o600});
console.log(`Archived ${countries.length} destinations. No cloud data was changed.`);
