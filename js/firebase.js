// Lightweight wrapper around the Firebase modular Web SDK. Loaded via the
// gstatic CDN so we keep the no-build, plain-ES-module setup.

import { FIREBASE_CONFIG } from './config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.13.2';

let _app = null;
let _auth = null;
let _firestore = null;
let _storage = null;

function isConfigured() {
  return (
    FIREBASE_CONFIG &&
    typeof FIREBASE_CONFIG.apiKey === 'string' &&
    !FIREBASE_CONFIG.apiKey.startsWith('REPLACE_ME') &&
    FIREBASE_CONFIG.apiKey.length > 10
  );
}

export function firebaseConfigured() {
  return isConfigured();
}

export async function getApp() {
  if (!isConfigured()) {
    throw new Error(
      'Firebase no está configurado. Edite js/config.js con los valores del proyecto.',
    );
  }
  if (_app) return _app;
  const { initializeApp } = await import(`${SDK_BASE}/firebase-app.js`);
  _app = initializeApp(FIREBASE_CONFIG);
  return _app;
}

export async function getAuth() {
  if (_auth) return _auth;
  const app = await getApp();
  const mod = await import(`${SDK_BASE}/firebase-auth.js`);
  _auth = mod.getAuth(app);
  // Cache imported helpers on the auth instance so callers can use them.
  _auth.__helpers = mod;
  return _auth;
}

export async function getFirestore() {
  if (_firestore) return _firestore;
  const app = await getApp();
  const mod = await import(`${SDK_BASE}/firebase-firestore.js`);
  _firestore = mod.getFirestore(app);
  _firestore.__helpers = mod;
  return _firestore;
}

export async function getStorage() {
  if (_storage) return _storage;
  const app = await getApp();
  const mod = await import(`${SDK_BASE}/firebase-storage.js`);
  _storage = mod.getStorage(app);
  _storage.__helpers = mod;
  return _storage;
}
