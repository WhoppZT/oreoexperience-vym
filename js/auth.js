// Admin authentication backed by Firebase Auth (Email/Password provider).
//
// We keep a tiny session flag in sessionStorage so the modal can immediately
// show the right state without waiting for the async Firebase user observer
// to fire.

import { firebaseConfigured, getAuth } from './firebase.js';

const SESSION_KEY = 'asignaciones-vym:admin-session';

async function ensureAuth() {
  if (!firebaseConfigured()) {
    throw new Error(
      'Firebase no está configurado todavía. Pídale al equipo que actualice js/config.js.',
    );
  }
  return getAuth();
}

export async function verifyCredentials(email, password) {
  try {
    const auth = await ensureAuth();
    const { signInWithEmailAndPassword } = auth.__helpers;
    await signInWithEmailAndPassword(auth, email.trim(), password);
    setLoggedIn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapAuthError(err) };
  }
}

export function setLoggedIn() {
  sessionStorage.setItem(SESSION_KEY, '1');
}

export function isLoggedIn() {
  if (sessionStorage.getItem(SESSION_KEY) === '1') return true;
  return false;
}

export async function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  try {
    const auth = await ensureAuth();
    const { signOut } = auth.__helpers;
    await signOut(auth);
  } catch {
    // ignore — local flag already cleared
  }
}

export async function watchAuthState(onChange) {
  try {
    const auth = await ensureAuth();
    const { onAuthStateChanged } = auth.__helpers;
    return onAuthStateChanged(auth, (user) => {
      if (user) setLoggedIn();
      else sessionStorage.removeItem(SESSION_KEY);
      onChange?.(user);
    });
  } catch {
    onChange?.(null);
    return () => {};
  }
}

function mapAuthError(err) {
  const code = err?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Correo o contraseña incorrectos.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Por favor espere unos minutos e intente de nuevo.';
  }
  if (code === 'auth/network-request-failed') {
    return 'No se pudo conectar al servidor. Verifique su conexión a internet.';
  }
  if (code === 'auth/invalid-email') {
    return 'El correo electrónico no es válido.';
  }
  if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
    return 'El inicio de sesión por correo y contraseña no está habilitado todavía en Firebase. Active "Authentication → Sign-in method → Correo electrónico/Contraseña".';
  }
  return err?.message || 'No se pudo iniciar sesión.';
}
