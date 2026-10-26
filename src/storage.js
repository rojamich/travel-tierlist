import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const KEY = 'travel-tiers-v3';
let database;
async function db() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('travel-tiers', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return database;
}

export const deviceStorage = {
  async load() {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: KEY });
      return value ? JSON.parse(value) : null;
    }
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction('state').objectStore('state').get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },
  async save(state) {
    if (Capacitor.isNativePlatform())
      return Preferences.set({ key: KEY, value: JSON.stringify(state) });
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(state, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error('Device storage is unavailable.'));
    });
  },
};

export async function getLegacyData() {
  try {
    const value = localStorage.getItem('travelTierListData');
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function saveSetting(key, value) {
  if (Capacitor.isNativePlatform()) return Preferences.set({ key, value });
  localStorage.setItem(key, value);
}
export async function getSetting(key) {
  if (Capacitor.isNativePlatform()) return (await Preferences.get({ key })).value;
  return localStorage.getItem(key);
}
