// Firebase project configuration.
//
// Replace the placeholder values below with the actual `firebaseConfig` block
// from your Firebase console:
//   Firebase Console → Project settings → General → Your apps → SDK setup
//
// These values are NOT secrets — they identify your Firebase project to the
// browser. Anyone can read them in the page source. Access control happens
// via Firestore/Storage Security Rules (see `firestore.rules` /
// `storage.rules` in this repo) and Firebase Authentication.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZ24_uwRDwKCooPvTYzdtOhEi67rHBNgk',
  authDomain: 'asignaciones-vym.firebaseapp.com',
  projectId: 'asignaciones-vym',
  storageBucket: 'asignaciones-vym.firebasestorage.app',
  messagingSenderId: '301803421907',
  appId: '1:301803421907:web:959ac3637d6800acab5426',
};

// When `true`, the app refuses to start until FIREBASE_CONFIG is filled in.
// Useful while wiring things up.
export const FIREBASE_REQUIRED = false;
