import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { PROFILE_KEYS, cleanMeta, cleanProfile, clone } from './model.js';
import { SyncQueue } from './store.js';

// Firebase web configuration identifies the project; access is enforced by firestore.rules.
const app = initializeApp({
  apiKey: 'AIzaSyCQ5YPI-2GttDgHV9_4ugVijY0p9l0Yimk',
  authDomain: 'travel-tiers.firebaseapp.com', projectId: 'travel-tiers',
  storageBucket: 'travel-tiers.firebasestorage.app', messagingSenderId: '158515437740',
  appId: '1:158515437740:web:213b3554ba8ad3022f7f09'
});
// Email/password needs no popup resolver or remote Google iframe; startup works offline.
const auth = initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence]});
const db = getFirestore(app);

function remoteEntity(snapshot, kind) {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return { data:kind === 'meta' ? cleanMeta(data) : cleanProfile(data), revision:data._rev || null };
}

export class CloudSync {
  constructor(store,onStatus) {
    this.store=store;this.onStatus=onStatus;this.stops=[];this.profileStops=new Map();this.queue=null;this.user=null;
    this.online=()=>this.retry();window.addEventListener('online',this.online);
    this.unsubscribeStore=store.subscribe(()=>{ if (this.queue && navigator.onLine) void this.queue.flush(); });
    this.unsubscribeAuth=onAuthStateChanged(auth,user=>{ void this.start(user).catch(error=>this.onStatus('error',error)); });
  }
  async signIn(email,password) { return signInWithEmailAndPassword(auth,email.trim(),password); }
  async register(email,password) {
    const result=await createUserWithEmailAndPassword(auth,email.trim(),password);
    await sendEmailVerification(result.user);
    return result;
  }
  async verify() { if (auth.currentUser) await sendEmailVerification(auth.currentUser); }
  async resetPassword(email) { await sendPasswordResetEmail(auth,email.trim()); }
  async refreshUser() { if(auth.currentUser) { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); await this.start(auth.currentUser); } }
  async signOut() { await signOut(auth); }
  stop() {
    this.queue?.stop();this.queue=null;
    for(const stop of this.stops) stop();this.stops=[];
    for(const stop of this.profileStops.values()) stop();this.profileStops.clear();
  }
  async start(user) {
    this.stop();this.user=user;
    if(!user) { this.onStatus('local');return; }
    if(!user.emailVerified) { this.onStatus('verify');return; }
    // Wait for an authorized server snapshot before uploading any local changes.
    this.onStatus(navigator.onLine?'connecting':'offline');
    const session=user.uid;
    const stop=onSnapshot(collection(db,'countries'),{includeMetadataChanges:true},snapshot=>{
      if(snapshot.metadata.fromCache || this.user?.uid!==session) return;
      void (async()=>{
        await this.store.claimSyncOwner(session);
        if(this.user?.uid!==session) return;
        await this.store.acceptMetaSnapshot(snapshot.docs.map(entry=>({id:entry.id,data:entry.data(),revision:entry.data()._rev||null})));
        const ids=new Set(snapshot.docs.map(entry=>entry.id));
        for(const [id,unsubscribe] of this.profileStops) if(!ids.has(id)) {unsubscribe();this.profileStops.delete(id);}
        for(const id of ids) if(!this.profileStops.has(id)) {
          this.profileStops.set(id,onSnapshot(collection(db,'countries',id,'profiles'),{includeMetadataChanges:true},profiles=>{
            if(profiles.metadata.fromCache || this.user?.uid!==session) return;
            void (async()=>{
              for(const key of PROFILE_KEYS) {
                const entry=profiles.docs.find(item=>item.id===key);
                if(entry) await this.store.acceptRemote(id,'profile',key,entry.data(),entry.data()._rev||null);
                // Legacy maps are upgraded by acceptMetaSnapshot; absence during that upgrade is not a reset.
                else if(this.store.entity(id).profiles[key]?.revision && !this.store.pending.some(op=>op.countryId===id && op.profile===key))
                  await this.store.acceptRemote(id,'profile',key,{},null);
              }
            })().catch(error=>this.onStatus('error',error));
          },error=>this.onStatus('error',error)));
        }
        if(!this.queue) this.queue=new SyncQueue(this.store,this.transport(),this.onStatus);
        await this.queue.flush();
      })().catch(error=>this.onStatus('error',error));
    },error=>{ this.stop();this.onStatus('error',error); });
    this.stops.push(stop);
  }
  transport() {
    return {commit:operation=>runTransaction(db,async transaction=>{
      const parent=doc(db,'countries',operation.countryId);
      const reference=operation.kind==='meta'?parent:doc(parent,'profiles',operation.profile);
      const snapshot=await transaction.get(reference);
      const remote=remoteEntity(snapshot,operation.kind);
      if(remote?.revision===operation.revision) return {ok:true}; // Idempotent retry after a lost acknowledgment.
      if(operation.kind==='profile') {
        const parentSnapshot=await transaction.get(parent);
        if(parentSnapshot.data()?.deleted) return {conflict:true,remote,reason:'deleted-country'};
      }
      if((remote?.revision||null)!==operation.baseRevision) return {conflict:true,remote,reason:'changed'};
      transaction.set(reference,{...clone(operation.data),_rev:operation.revision,updatedAt:serverTimestamp()});
      return {ok:true};
    })};
  }
  async retry() {
    if(!navigator.onLine) {this.onStatus('offline');return;}
    if(this.queue) await this.queue.flush();
    else if(this.user) await this.start(this.user);
    else this.onStatus('local');
  }
}
