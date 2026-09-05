# Alamza Notes — where the code lives

The app is **one class**. Its methods are stored across several files so each
area can be opened on its own; `this` is the same object in every one of them.
Nothing here is a module boundary — it is a filing system.

```
index.dc.html      the template (markup) + the app shell: state, lifecycle, persist
lib/parts.js       folds lib/part-*.js back onto the class
lib/helpers.js     free functions shared by all of it (uid, escaping, text utils)
```

## Editing rules

**To change a method, edit it where it lives — do not move it.** Any part file
can be edited on its own; the app picks it up on reload.

**To add a method,** put it in the part that owns the area and nowhere else.

**Pick a name no other part has taken.** Every part is folded onto the SAME
prototype, so two parts defining `foo()` means one of them silently disappears
and which one survives depends on `<script>` order. `AlamzaParts` now warns on
the console when a name is claimed twice, naming both files — a database helper
called `editText` had already replaced the editor's, which would have stopped
typing in a block working at all.

**Method syntax inside a part is the same as inside a class.** A part is written
as an anonymous class for exactly that reason:

```js
AlamzaParts.register(class {
  myMethod(arg) { return this.state.pages[arg]; }   // `this` is the app
});
```

So a method can be moved between files, or back into `index.dc.html`, by plain
copy/paste — no commas to add, no re-indenting, nothing to rewrite.

**Load order does not matter.** A part that arrives late attaches itself and
repaints. New part files need a `<script src>` in the `<helmet>` block of
`index.dc.html`, next to the others.

**Two things must stay in `index.dc.html`:** the `state = { … }` and `_els = {}`
style field declarations (they are per-instance, not prototype), and the
template itself.

## The parts

| File | Lines | What it owns |
| --- | ---: | --- |
| `lib/part-data.js` | 377 | Reading and writing state safely |
| `lib/part-editor.js` | 1091 | The typing surface |
| `lib/part-pages.js` | 526 | Moving between pages, and the page tree |
| `lib/part-versions.js` | 686 | Snapshots, diff and restore |
| `lib/part-blocks.js` | 278 | Block structure |
| `lib/part-database.js` | 1419 | Tables |
| `lib/part-drag.js` | 368 | Dragging |
| `lib/part-tools.js` | 1647 | Everything else the page needs |
| `lib/part-menus.js` | 1663 | What menus, modals and sheets contain |
| `lib/part-render.js` | 810 | What the template receives |
| `index.dc.html` | 2388 | template + state, lifecycle, persist |

## Method index

Grep this instead of the codebase.

**`lib/part-data.js`** — `page`, `resolvePageId`, `dbFor`, `activeBlocks`, `bodyReady`, `ensureBody`, `ensureBodies`, `needParent`, `digestMap`, `digestFor`, `rowsReady`, `ensureRows`, `repairRowPages`, `repairAllRowPages`, `dbIdsIn`, `ensureRowsFor`, `backendLabel`, `myRole`, `canEdit`, `canComment`, `canWriteHistory`, `isReadOnly`, `patchPage`, `setBlocks`, `locate`, `miniRow`, `mutate`, `_mutate`

**`lib/part-editor.js`** — `nearView`, `syncDom`, `blockHtml`, `elRef`, `mathRef`, `gutRef`, `paintGutter`, `afterEdit`, `highlightNow`, `codeEdit`, `setCodeText`, `readBlock`, `editText`, `selectBlockRange`, `growBlockSel`, `onInput`, `caretRect`, `clearTrigger`, `insertMention`, `tryShortcut`, `insertAfter`, `removeBlock`, `onKey`, `wrapSel`, `onPaste`, `onFocus`, `onBlur`

**`lib/part-pages.js`** — `flat`, `openPage`, `mobileBack`, `goHome`, `newPage`, `versionById`, `normSnap`, `vsnap`, `vblocks`, `ensureVersion`, `syncVersionMeta`, `ensureVersionMeta`, `primeLatestVersion`, `cacheVersion`, `touchVersion`, `trimVersionCache`, `forgetVersions`, `checkRoVersion`, `versionMetaKnown`, `versionGone`, `mergeVersions`, `deleteVersion`, `subtreeIds`, `snapshotIds`, `descendants`, `trashPage`, `restorePage`

**`lib/part-versions.js`** — `toggleTheme`, `toggleSource`, `toast`, `copyMarkdown`, `buildSnapshot`, `ensureSnapshotReady`, `ensureBaseline`, `nextVersionN`, `createVersion`, `authorVersion`, `autoMessage`, `captureScope`, `remapSnapshot`, `remapVersionMeta`, `dbsUsedBy`, `restoreScope`, `restore`, `applyRestore`, `pickDiffSide`, `openDiff`, `diffPending`, `blocksOf`, `diffScope`, `labelOf`, `diffText`, `diffStyle`, `tokens`, `plain`

**`lib/part-blocks.js`** — `moveBlock`, `startDrag`, `turnInto`, `duplicateBlock`, `insertOfType`, `slashKey`, `slashCatalog`, `mentionCatalog`

**`lib/part-database.js`** — `chipColor`, `cellText`, `cellRaw`, `isBlank`, `dateNum`, `isDateType`, `stampRows`, `boardGroupProp`, `groupVals`, `boardGroups`, `filterOps`, `matchFilter`, `applyFilters`, `cmpCells`, `sortRows`, `dbRowVals`, `typableProp`, `stepCell`, `openRowPage`, `collectDatabases`, `dbReferenced`, `dropDatabases`, `deleteDatabase`, `cleanUnusedTables`, `addRow`, `deleteRow`, `setCell`, `coerceCell`, `toggleOption`, `knownPeople`, `propFields`, `normProp`, `normDb`, `optOf`, `optStyle`, `addProp`, `renameProp`, `retypeProp`, `deleteProp`, `duplicateProp`, `moveProp`, `addOption`, `renameOption`, `recolorOption`, `deleteOption`, `moveOption`, `isHiddenInView`, `toggleViewProp`, `togglePageProp`, `toggleProp`, `moveRow`, `flipRows`, `dbBleed`, `applyRowDrop`, `setRowGroup`

**`lib/part-drag.js`** — `rowGrab`, `patchDb`

**`lib/part-tools.js`** — `escapeKey`, `readHtml`, `histFor`, `histJson`, `syncTail`, `applyHist`, `undo`, `redo`, `isAncestor`, `repair`, `mergePrev`, `removeAt`, `caretX`, `caretToX`, `histJsonDeep`, `syncTailDeep`, `applyMark`, `setBlockColor`, `openSearch`, `flashBlock`, `changedIds`, `tableEdit`, `tableAdd`, `tableDel`, `commentCount`, `addComment`, `resolveComment`, `origin`, `pageUrl`, `shareUrl`, `inviteUrl`, `publishSnapshot`, `setPublished`, `pubKey`, `publishInSync`, `republish`, `schedulePublish`, `flushPublish`, `openPublic`, `publicSlugFromUrl`, `shareRoles`, `shareMembers`, `sendInvite`, `revokeInvite`, `syncShared`, `flushShareSync`, `scheduleShareSync`, `refreshInbox`, `answerInvite`, `openShared`, `leaveShared`, `iconEl`, `childrenOf`, `reconcileChildren`, `stripSubpage`, `movePage`, `navGrab`, `startResize`, `deepDuplicatePage`, `lassoStart`, `trackAnchor`, `pageStats`, `headingHits`, `tableNav`, `upModal`

**`lib/part-menus.js`** — `extraVals`

**`lib/part-render.js`** — `renderVals`

## Where to start, by task

| Task | File |
| --- | --- |
| Typing, keyboard shortcuts, paste, code blocks | `part-editor.js` |
| A page opens wrong / sub-page bugs / trash | `part-pages.js` |
| Snapshots, diff, restore | `part-versions.js` |
| Table columns, filters, sorts, rows | `part-database.js` |
| Reordering by dragging | `part-drag.js` |
| A menu item, a modal, a mobile sheet | `part-menus.js` |
| Something shows the wrong value in the UI | `part-render.js` |
| What the UI looks like | the template in `index.dc.html` |
| Loading, saving, bandwidth | `lib/store.js` |
| Which database the app uses | `lib/config.js` |
| Teaching the app a new database | `lib/data/port.js`, then a new `lib/data/backend-*.js` |

## Tests

```
node test/run.js            every suite
node test/run.js A4         only suites/tests whose name matches
```

No dependencies and no build. `test/harness.js` assembles the same prototype
`lib/parts.js` builds, inside a Node `vm` context, and hands back a live
instance with a recording store stub — so the parts can be driven exactly as
the app drives them, without a DOM. `setState` commits synchronously there, and
`loadRealStore()` runs the real `lib/store.js` against a stub BACKEND whose
writes can be made to fail on command — or, given `{ backend: fn }`, against a
real one. `makeDataContext()` loads `lib/data/*` on its own, with no app and no
store, which is what lets the conformance suite drive a backend directly.
`test/fake-firestore.js` is a Firestore that lives in a Map and rejects a nested
array exactly as the real one does, so `lib/data/backend-firestore.js` is tested
for real without a network.

`test/template.test.js` is the one that guards `index.html`: it parses the app
shell and checks that every `{{ binding }}` in the markup is actually produced
by `renderVals()`, which otherwise fails silently as a blank node — and runs
`renderVals()` over every combination of store flags, because it branches on
what the STORE says as well as on the state and a crash in one of those
branches once survived a green run all the way into the browser.

`opts.register` on `loadRealStore()` registers a backend and an auth provider
BEFORE `lib/store.js` is evaluated, which is what lets a test drive the real
boot — the auth callback, the layout check, the listeners — rather than only
the parts reachable afterwards.

## Data layer

```
lib/config.js               THE config file — which database, and every setting
lib/data/port.js            the contract every backend implements
lib/data/registry.js        register a backend; turn the config into a live one
lib/data/firebase-app.js    one shared Firebase app + SDK import
lib/data/auth.js            who is signed in: firebase | local | rest
lib/data/backend-local.js       this browser (localStorage)
lib/data/backend-rtdb.js        Firebase Realtime Database
lib/data/backend-firestore.js   Cloud Firestore
lib/data/backend-rest.js        your own API
lib/data/backend-routing.js     several of the above at once, split by kind
lib/store.js                the app-facing API — caching, diffing, cost, retry
lib/markdown.js             markdown <-> blocks, and the marker map the caret needs
lib/diff.js                 block + word level diff
lib/seed.js                 demo workspace
lib/database.rules.json     security rules for the Realtime Database
lib/firestore.rules         security rules for Firestore
```

### How a database is chosen

`lib/config.js` has one line — `backend:` — and everything else follows from it.
The registry resolves that line to a backend, records WHY in `AlamzaData.chose`,
and Settings → Data & sync prints the answer. `lib/store.js` names no database
at all; it asks the port to read a path, write a patch, or watch a collection.

`AStore.cloud` is the question the app actually asks — is there a server, or is
this browser the only copy? `AStore.mode` is the name that question used to
have; it is now derived from `cloud` and kept only for anything outside this
repo that still reads it.

### Adding a database

Two steps, and neither is in a file that already exists:

1. Write `lib/data/backend-<yours>.js` ending in
   `AlamzaData.registerBackend('yours', factory)`.
2. Add its `<script>` to `index.html` and a `yours: { … }` block to
   `lib/config.js`.

`test/f1-port-conformance.test.js` then holds it to the same behaviour as every
other backend — that check is what makes swapping one a config change rather
than a debugging session.

### The addresses

Everything the app stores has a logical path, and those paths are the app's
vocabulary rather than any database's. A backend maps them to wherever it keeps
bytes:

| logical | Realtime Database | Firestore |
| --- | --- | --- |
| `idx/<pageId>` | `workspaces/<uid>/idx/<pageId>` | `workspaces/<uid>/idx/<pageId>` |
| `meta` | `workspaces/<uid>/meta` | `workspaces/<uid>/_/meta` |
| `dbrow/<dbId>/<rowId>` | same, nested | `workspaces/<uid>/dbrow/<dbId>/_/<rowId>` |
| `pub/<slug>` | `pub/<slug>` | `pub/<slug>` |
| `inbox/<key>/<id>` | `inbox/<key>/<id>` | `inbox/<key>/_/<id>` |

Firestore has to alternate collection and document, so an odd-length path gains
one `_` segment before its last. Its documents also cannot hold an array inside
an array, and a page's blocks are full of them, so the value is stored as one
JSON field with the handful of fields a security rule must read copied out
beside it.

`requirements.md` remains the specification — behaviour, contracts and the
reasons behind them. This file is only a map.
