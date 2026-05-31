// Hybrid storage layer:
//   - Firestore: shared "source of truth" so the admin uploads once and every
//     visitor sees the same data. Only the parsed weeks JSON is stored; the
//     PDF blob itself stays local (Firebase Storage requires a paid plan).
//   - IndexedDB: local cache so the page works fully offline after the first
//     load, and so the admin can still re-open the original PDF.
//
// Public read of the parsed weeks JSON is allowed (see firestore.rules).
// Writes require a signed-in admin user (Firebase Auth).

import { firebaseConfigured, getFirestore } from './firebase.js';

const DB_NAME = 'asignaciones-vym';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_WEEKS = 'weeks';
const STORE_PDF = 'pdf';

const FS_COLLECTION = 'assignments';
const FS_DOC = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_WEEKS)) {
        db.createObjectStore(STORE_WEEKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PDF)) {
        db.createObjectStore(STORE_PDF);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------- local cache ----------------------

async function saveLocal(weeks, meta) {
  const db = await openDb();
  const t = db.transaction([STORE_WEEKS, STORE_META], 'readwrite');
  await promisify(t.objectStore(STORE_WEEKS).clear());
  for (const w of weeks) {
    await promisify(t.objectStore(STORE_WEEKS).put(w));
  }
  await promisify(t.objectStore(STORE_META).put(meta, 'current'));
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function loadLocal() {
  const db = await openDb();
  const t = db.transaction([STORE_WEEKS, STORE_META]);
  const weeks = await promisify(t.objectStore(STORE_WEEKS).getAll());
  const meta = await promisify(t.objectStore(STORE_META).get('current'));
  weeks.sort((a, b) => a.startMs - b.startMs);
  return { weeks, meta };
}

export async function clearAllLocal() {
  const db = await openDb();
  const t = db.transaction([STORE_WEEKS, STORE_META, STORE_PDF], 'readwrite');
  await promisify(t.objectStore(STORE_WEEKS).clear());
  await promisify(t.objectStore(STORE_META).clear());
  await promisify(t.objectStore(STORE_PDF).clear());
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function savePdfBlobLocal(blob) {
  const db = await openDb();
  const t = db.transaction([STORE_PDF], 'readwrite');
  await promisify(t.objectStore(STORE_PDF).put(blob, 'current'));
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadPdfBlobLocal() {
  const db = await openDb();
  const t = db.transaction([STORE_PDF]);
  return promisify(t.objectStore(STORE_PDF).get('current'));
}

// ---------------------- remote (Firestore) ----------------------

async function loadRemote() {
  if (!firebaseConfigured()) return null;
  const fs = await getFirestore();
  const { doc, getDoc } = fs.__helpers;
  const snap = await getDoc(doc(fs, FS_COLLECTION, FS_DOC));
  if (!snap.exists()) return null;
  const raw = snap.data() || {};
  const weeks = Array.isArray(raw.weeks) ? raw.weeks : [];
  const meta = raw.meta || null;
  return { weeks, meta };
}

async function saveRemote(weeks, meta) {
  if (!firebaseConfigured()) {
    throw new Error('Firebase no está configurado. No se puede compartir.');
  }
  const fs = await getFirestore();
  const { doc, setDoc, serverTimestamp } = fs.__helpers;

  await setDoc(doc(fs, FS_COLLECTION, FS_DOC), {
    weeks,
    meta,
    updatedAt: serverTimestamp(),
  });
}

async function deleteRemote() {
  if (!firebaseConfigured()) return;
  const fs = await getFirestore();
  const { doc, deleteDoc } = fs.__helpers;
  try {
    await deleteDoc(doc(fs, FS_COLLECTION, FS_DOC));
  } catch (err) {
    // It's fine if the doc is already gone.
    if (err?.code !== 'not-found') throw err;
  }
}

// ---------------------- public API ----------------------

export async function saveWeeks(weeks, meta, pdfFile = null) {
  // Save locally first so the admin sees their upload immediately even if the
  // network call is slow.
  await saveLocal(weeks, meta);
  if (pdfFile) {
    try {
      await savePdfBlobLocal(pdfFile);
    } catch (err) {
      console.warn('No se pudo cachear el PDF localmente:', err);
    }
  }
  if (firebaseConfigured()) {
    try {
      await saveRemote(weeks, meta);
    } catch (err) {
      // Re-throw so the UI can report the failure — local data is fine but
      // it won't reach other devices.
      throw new Error(
        `Las asignaciones se guardaron localmente, pero no se pudieron publicar al servidor compartido: ${err.message || err}`,
      );
    }
  }
}

export async function loadWeeks() {
  // Try remote first (so a returning visitor with internet sees the latest
  // upload). Fall back to local cache when offline.
  if (firebaseConfigured()) {
    try {
      const remote = await loadRemote();
      if (remote && remote.weeks?.length) {
        await saveLocal(remote.weeks, remote.meta).catch((err) => {
          console.warn('No se pudo refrescar la caché local:', err);
        });
        return remote;
      }
    } catch (err) {
      console.warn('No se pudo cargar desde el servidor compartido, usando caché local:', err);
    }
  }
  return loadLocal();
}

export async function clearAll() {
  if (firebaseConfigured()) {
    try {
      await deleteRemote();
    } catch (err) {
      throw new Error(
        `No se pudieron borrar las asignaciones del servidor: ${err.message || err}`,
      );
    }
  }
  await clearAllLocal();
}

// Convenience aliases kept for backward compatibility with the previous
// version of the module.
export const savePdfBlob = savePdfBlobLocal;
export const loadPdfBlob = loadPdfBlobLocal;

// ---------------------- acomodadores image ----------------------

const FS_ACOMODADORES_COLLECTION = 'acomodadores';
const FS_ACOMODADORES_DOC = 'current';

export async function saveAcomodadoresImage(dataUrl) {
  if (!firebaseConfigured()) {
    throw new Error('Firebase no está configurado.');
  }
  const fs = await getFirestore();
  const { doc, setDoc, serverTimestamp } = fs.__helpers;
  await setDoc(doc(fs, FS_ACOMODADORES_COLLECTION, FS_ACOMODADORES_DOC), {
    imageData: dataUrl,
    updatedAt: serverTimestamp(),
  });
}

export async function loadAcomodadoresImage() {
  if (!firebaseConfigured()) return null;
  const fs = await getFirestore();
  const { doc, getDoc } = fs.__helpers;
  const snap = await getDoc(doc(fs, FS_ACOMODADORES_COLLECTION, FS_ACOMODADORES_DOC));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data?.imageData || null;
}

export async function clearAcomodadoresImage() {
  if (!firebaseConfigured()) return;
  const fs = await getFirestore();
  const { doc, deleteDoc } = fs.__helpers;
  try {
    await deleteDoc(doc(fs, FS_ACOMODADORES_COLLECTION, FS_ACOMODADORES_DOC));
  } catch (err) {
    if (err?.code !== 'not-found') throw err;
  }
}
