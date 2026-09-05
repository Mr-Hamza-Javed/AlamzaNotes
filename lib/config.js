/* =============================================================================
 * ALAMZA NOTES — THE CONFIGURATION FILE
 * =============================================================================
 *
 * This is the ONE file you edit to change where Alamza Notes keeps its data.
 * Nothing else in the app names a database. Change the value on the very next
 * line, reload the page, and the whole app is running on a different store.
 *
 * -----------------------------------------------------------------------------
 * 1. WHICH DATABASE AM I USING?                       <-- change this one line
 * -----------------------------------------------------------------------------
 *
 *   'rtdb'       Firebase Realtime Database.  The default, and what every
 *                existing account is stored in today. Live updates, cheapest
 *                for this app's shape, billed on bytes DOWNLOADED.
 *
 *   'firestore'  Google Cloud Firestore.  Also live. Billed per DOCUMENT READ
 *                rather than per byte, so it is the better choice if pages get
 *                very large, and the worse choice if there are very many small
 *                ones. Needs `firestore` filled in below and the rules from
 *                lib/firestore.rules deployed.
 *
 *   'rest'       Your own API (the Node server you may write later). Nothing
 *                here needs to change when you build it — fill in `rest.baseUrl`
 *                below and switch this line. See lib/data/backend-rest.js for
 *                the eight endpoints your server has to answer.
 *
 *   'local'      This browser only (localStorage). No account, no network.
 *                Used automatically when no cloud config is filled in, and by
 *                the "Explore the demo" button on the sign-in screen.
 *
 *   'routing'    Use SEVERAL of the above AT THE SAME TIME, split by the kind
 *                of data. Configure it in `routing` further down. This is how
 *                you would keep the live index in the Realtime Database while
 *                page bodies go to Firestore, or move one kind of data at a
 *                time onto your own API without a big-bang migration.
 *
 * Setting it to 'auto' picks the first backend whose configuration is filled
 * in, in this order: routing, rest, rtdb, firestore, local.
 *
 * NOTE ON 'auto' AND THE TWO FIREBASE BLOCKS. They describe the same project
 * and differ by one field, so filling in the Firestore block below leaves both
 * of them configured. 'auto' therefore prefers the Realtime Database, which is
 * where this app has always kept data — otherwise merely PREPARING to try
 * Firestore would point a live account at an empty database and make every note
 * in it look deleted. Moving is something you say, on the line below.
 */
window.ALAMZA_CONFIG = {

  backend: 'rtdb',

  /* ---------------------------------------------------------------------------
   * 2. WHO SIGNS THE USER IN?
   * ---------------------------------------------------------------------------
   * Sign-in and storage are separate choices, because they usually are in real
   * life: you can keep Google sign-in while moving your data to your own API.
   *
   *   'auto'      match the backend — Firebase backends get Firebase Auth,
   *               'rest' gets token auth, 'local' gets the offline demo user.
   *               Leave it on 'auto' unless you have a reason.
   *   'firebase'  Google sign-in through Firebase Auth.
   *   'rest'      your own API issues a token. See lib/data/auth-rest.js.
   *   'local'     no real sign-in; a demo user is invented and kept in this
   *               browser. This is what demo mode uses.
   */
  auth: 'auto',

  /* ---------------------------------------------------------------------------
   * 3. THE BACKENDS THEMSELVES
   * ---------------------------------------------------------------------------
   * Every backend has its own block. A block that is not filled in is simply
   * unavailable — it is never an error to leave one empty, and 'auto' above
   * skips it. Filling one in does NOT switch to it; only `backend` does that.
   */
  backends: {

    /* ---- Firebase Realtime Database ---------------------------------------
     * Copy these values from the Firebase console:
     *   Project settings -> General -> Your apps -> SDK setup and configuration
     * `databaseURL` is the one that decides this is a Realtime Database; it is
     * the field the app checks to know whether RTDB is configured at all.
     * Deploy lib/database.rules.json alongside it, or every read is denied.
     */
    rtdb: {
      apiKey: "AIzaSyAM7XHVtCBVA6Vz31U_LB1FnUsm3I208xQ",
      authDomain: "alamza-notes.firebaseapp.com",
      databaseURL: "https://alamza-notes-default-rtdb.firebaseio.com",
      projectId: "alamza-notes",
      storageBucket: "alamza-notes.firebasestorage.app",
      messagingSenderId: "785776966178",
      appId: "1:785776966178:web:067732c7a66face05de87b",
      measurementId: "G-KGNGX45BKX"
    },

    /* ---- Cloud Firestore ---------------------------------------------------
     * The SAME Firebase project can serve both databases at once, so this block
     * is usually the RTDB block minus `databaseURL`. Firestore is identified by
     * `projectId` and by nothing else, which is why the two can share a project
     * and why `databaseURL` must NOT be copied in here.
     *
     * Before switching to it:
     *   1. Firebase console -> Build -> Firestore Database -> Create database.
     *   2. Deploy lib/firestore.rules (console -> Firestore -> Rules -> paste).
     *   3. Set `backend` above to 'firestore' and reload.
     *
     * A Firestore workspace starts EMPTY. Switching does not copy anything
     * across — the two databases are separate places. Export from Settings ->
     * Data & sync before you switch if you want to carry a workspace over.
     *
     * `databaseId` names a secondary Firestore database if you made one;
     * leave it empty for the normal single database.
     */
    firestore: {
      apiKey: "AIzaSyAM7XHVtCBVA6Vz31U_LB1FnUsm3I208xQ",
      authDomain: "alamza-notes.firebaseapp.com",
      projectId: "alamza-notes",
      storageBucket: "alamza-notes.firebasestorage.app",
      messagingSenderId: "785776966178",
      appId: "1:785776966178:web:067732c7a66face05de87b",
      databaseId: ""
    },

    /* ---- Your own API (Node, or anything else) -----------------------------
     * Empty until you build it, which is the point: the app is already able to
     * talk to it, so the day the server exists this is the only edit.
     *
     *   baseUrl   where the API lives, no trailing slash, e.g.
     *             "https://api.alamza.example" or "http://localhost:8080/api"
     *   live      "sse"  the server pushes changes over Server-Sent Events
     *             "poll" the app asks every `pollMs` instead
     *             "off"  no live updates; other devices are seen on reload
     *   pollMs    how often to ask, when live is "poll"
     *   headers   sent with every request (an API key, a tenant id, …). The
     *             signed-in user's token is added automatically — do not put a
     *             token here.
     *
     * lib/data/backend-rest.js documents the exact request and response shape
     * of every endpoint. It is eight of them and they are all small.
     */
    rest: {
      baseUrl: "",
      live: "sse",
      pollMs: 15000,
      headers: {}
    },

    /* ---- This browser only -------------------------------------------------
     * Always available, needs nothing. `namespace` lets two copies of the app
     * on the same domain keep separate data.
     */
    local: {
      namespace: "alamza"
    }
  },

  /* ---------------------------------------------------------------------------
   * 4. USING MORE THAN ONE DATABASE AT ONCE
   * ---------------------------------------------------------------------------
   * Only read when `backend` above is set to 'routing'.
   *
   * The app stores nine KINDS of thing. Each line below sends one kind to one
   * backend. `default` catches everything not named.
   *
   *   idx      one small entry per page: title, icon, parent, flags. This is
   *            the only thing loaded at startup, and the sidebar is built from
   *            it. Keep it on a backend with live updates.
   *   body     the blocks of a page. The bulk of the data. Loaded on open.
   *   dig      search keywords per page. Loaded once, when search is opened.
   *   vmeta    the list of a page's snapshots (dates, names, sizes).
   *   vdata    the contents of one snapshot. Written once, read rarely.
   *   dbmeta   a table's columns, views and row order.
   *   dbrow    one row of a table.
   *   dbrev    a ~60 byte "this table changed" ping. Live updates only.
   *   sys      workspace preferences, and the storage-layout stamp.
   *
   * A worked example — move the heavy data to your own API first, and leave
   * everything the sidebar needs where it already works:
   *
   *   backend: 'routing',
   *   routing: {
   *     default: 'rtdb',
   *     body:    'rest',
   *     vdata:   'rest'
   *   }
   *
   * Two warnings, both of them real:
   *   - A page's body and its index entry can now be on different machines, so
   *     a failure can leave one written and the other not. The app already
   *     retries a failed write, but two backends means two ways to be behind.
   *   - Nothing is copied when you change a line here. Data written to the old
   *     backend stays there and simply stops being visible.
   */
  routing: {
    default: 'rtdb'
  },

  /* ---------------------------------------------------------------------------
   * 5. THINGS YOU ARE UNLIKELY TO CHANGE
   * ---------------------------------------------------------------------------
   *   cacheBudget   bytes of page bodies and table rows kept in this browser,
   *                 so a reload paints instantly and re-reads nothing. The
   *                 oldest are dropped first. localStorage is usually capped
   *                 near 5 MB in total, so leave room for the rest of the app.
   *   pushDelayMs   how long typing has to pause before the app writes to the
   *                 network. Lower means fresher on other devices and more
   *                 writes; higher means fewer writes and a longer window in
   *                 which a crash loses recent typing. A save also happens on
   *                 every blur, tab switch and page close regardless.
   *   mirrorDelayMs the same pause, for the copy kept in this browser. Short,
   *                 because it costs nothing and protects against a refresh.
   *   strictContract check on startup that the selected backend really answers
   *                 every call the app makes, and say so loudly in the console
   *                 if it does not. Worth leaving on while you write your own.
   */
  tuning: {
    cacheBudget: 2400000,
    pushDelayMs: 2200,
    mirrorDelayMs: 240,
    strictContract: true
  }
};

/* -----------------------------------------------------------------------------
 * COMPATIBILITY — do not edit below this line.
 *
 * Older parts of the app, and anything you may have deployed already, read
 * `window.ALAMZA_FIREBASE_CONFIG`. It is derived from the block above so there
 * is still exactly ONE place to edit. Setting it by hand also still works: it
 * is treated as the rtdb block when that block is empty, which is what keeps an
 * existing lib/firebase-config.js deployment running unchanged.
 * -------------------------------------------------------------------------- */
(function () {
  var c = window.ALAMZA_CONFIG;
  var rtdb = (c.backends && c.backends.rtdb) || {};
  if (!rtdb.apiKey && window.ALAMZA_FIREBASE_CONFIG) {
    c.backends = c.backends || {};
    c.backends.rtdb = window.ALAMZA_FIREBASE_CONFIG;
    return;
  }
  window.ALAMZA_FIREBASE_CONFIG = rtdb;
})();
