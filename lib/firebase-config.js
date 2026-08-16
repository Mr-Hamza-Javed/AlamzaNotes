/* Alamza Notes — Firebase configuration.
 *
 * FIREBASE MODE (active): the app uses Firebase Auth (Google) and writes every
 * page to the Realtime Database under workspaces/<uid>.
 *
 * DEMO MODE: the sign-in screen also offers "Explore the demo". That switches
 * the app to the local adapter (localStorage, seeded workspace) even though the
 * config below is filled in, and remembers the choice until the user leaves it
 * from Settings → Data & sync.
 *
 * To go back to a config-free build, empty the fields.
 */
window.ALAMZA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAM7XHVtCBVA6Vz31U_LB1FnUsm3I208xQ",
  authDomain: "alamza-notes.firebaseapp.com",
  databaseURL: "https://alamza-notes-default-rtdb.firebaseio.com",
  projectId: "alamza-notes",
  storageBucket: "alamza-notes.firebasestorage.app",
  messagingSenderId: "785776966178",
  appId: "1:785776966178:web:067732c7a66face05de87b",
  measurementId: "G-KGNGX45BKX"
};
