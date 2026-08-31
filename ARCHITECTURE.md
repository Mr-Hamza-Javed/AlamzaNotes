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
| `lib/part-data.js` | 358 | Reading and writing state safely |
| `lib/part-editor.js` | 1091 | The typing surface |
| `lib/part-pages.js` | 523 | Moving between pages, and the page tree |
| `lib/part-versions.js` | 686 | Snapshots, diff and restore |
| `lib/part-blocks.js` | 278 | Block structure |
| `lib/part-database.js` | 1415 | Tables |
| `lib/part-drag.js` | 368 | Dragging |
| `lib/part-tools.js` | 1441 | Everything else the page needs |
| `lib/part-menus.js` | 1604 | What menus, modals and sheets contain |
| `lib/part-render.js` | 763 | What the template receives |
| `index.dc.html` | 2321 | template + state, lifecycle, persist |

## Method index

Grep this instead of the codebase.

**`lib/part-data.js`** — `page`, `resolvePageId`, `dbFor`, `activeBlocks`, `bodyReady`, `ensureBody`, `ensureBodies`, `needParent`, `digestMap`, `digestFor`, `rowsReady`, `ensureRows`, `repairRowPages`, `repairAllRowPages`, `dbIdsIn`, `ensureRowsFor`, `myRole`, `canEdit`, `canComment`, `canWriteHistory`, `isReadOnly`, `patchPage`, `setBlocks`, `locate`, `miniRow`, `mutate`, `_mutate`

**`lib/part-editor.js`** — `nearView`, `syncDom`, `blockHtml`, `elRef`, `mathRef`, `gutRef`, `paintGutter`, `afterEdit`, `highlightNow`, `codeEdit`, `setCodeText`, `readBlock`, `editText`, `selectBlockRange`, `growBlockSel`, `onInput`, `caretRect`, `clearTrigger`, `insertMention`, `tryShortcut`, `insertAfter`, `removeBlock`, `onKey`, `wrapSel`, `onPaste`, `onFocus`, `onBlur`

**`lib/part-pages.js`** — `flat`, `openPage`, `mobileBack`, `goHome`, `newPage`, `versionById`, `normSnap`, `vsnap`, `vblocks`, `ensureVersion`, `syncVersionMeta`, `ensureVersionMeta`, `primeLatestVersion`, `cacheVersion`, `touchVersion`, `trimVersionCache`, `forgetVersions`, `checkRoVersion`, `versionMetaKnown`, `versionGone`, `mergeVersions`, `deleteVersion`, `subtreeIds`, `snapshotIds`, `descendants`, `trashPage`, `restorePage`

**`lib/part-versions.js`** — `toggleTheme`, `toggleSource`, `toast`, `copyMarkdown`, `buildSnapshot`, `ensureSnapshotReady`, `ensureBaseline`, `nextVersionN`, `createVersion`, `authorVersion`, `autoMessage`, `captureScope`, `remapSnapshot`, `remapVersionMeta`, `dbsUsedBy`, `restoreScope`, `restore`, `applyRestore`, `pickDiffSide`, `openDiff`, `diffPending`, `blocksOf`, `diffScope`, `labelOf`, `diffText`, `diffStyle`, `tokens`, `plain`

**`lib/part-blocks.js`** — `moveBlock`, `startDrag`, `turnInto`, `duplicateBlock`, `insertOfType`, `slashKey`, `slashCatalog`, `mentionCatalog`

**`lib/part-database.js`** — `chipColor`, `cellText`, `cellRaw`, `isBlank`, `dateNum`, `isDateType`, `stampRows`, `boardGroupProp`, `groupVals`, `boardGroups`, `filterOps`, `matchFilter`, `applyFilters`, `cmpCells`, `sortRows`, `dbRowVals`, `typableProp`, `stepCell`, `openRowPage`, `collectDatabases`, `dbReferenced`, `dropDatabases`, `deleteDatabase`, `cleanUnusedTables`, `addRow`, `deleteRow`, `setCell`, `coerceCell`, `toggleOption`, `knownPeople`, `propFields`, `normProp`, `normDb`, `optOf`, `optStyle`, `addProp`, `renameProp`, `retypeProp`, `deleteProp`, `duplicateProp`, `moveProp`, `addOption`, `renameOption`, `recolorOption`, `deleteOption`, `moveOption`, `isHiddenInView`, `toggleViewProp`, `togglePageProp`, `toggleProp`, `moveRow`, `flipRows`, `dbBleed`, `applyRowDrop`, `setRowGroup`

**`lib/part-drag.js`** — `rowGrab`, `patchDb`

**`lib/part-tools.js`** — `escapeKey`, `readHtml`, `histFor`, `histJson`, `syncTail`, `applyHist`, `undo`, `redo`, `isAncestor`, `repair`, `mergePrev`, `removeAt`, `caretX`, `caretToX`, `histJsonDeep`, `syncTailDeep`, `applyMark`, `setBlockColor`, `openSearch`, `flashBlock`, `changedIds`, `tableEdit`, `tableAdd`, `tableDel`, `commentCount`, `addComment`, `resolveComment`, `origin`, `pageUrl`, `shareUrl`, `inviteUrl`, `publishSnapshot`, `setPublished`, `republish`, `openPublic`, `publicSlugFromUrl`, `sendInvite`, `invitedMe`, `answerInvite`, `iconEl`, `childrenOf`, `reconcileChildren`, `stripSubpage`, `movePage`, `navGrab`, `startResize`, `deepDuplicatePage`, `lassoStart`, `trackAnchor`, `pageStats`, `headingHits`, `tableNav`, `upModal`

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

## Tests

```
node test/run.js            every suite
node test/run.js A4         only suites/tests whose name matches
```

No dependencies and no build. `test/harness.js` assembles the same prototype
`lib/parts.js` builds, inside a Node `vm` context, and hands back a live
instance with a recording store stub — so the parts can be driven exactly as
the app drives them, without a DOM. `setState` commits synchronously there, and
`loadRealStore()` runs the real `lib/store.js` against a Firebase stub whose
writes can be made to fail on command.

`test/template.test.js` is the one that guards `index.html`: it parses the app
shell and checks that every `{{ binding }}` in the markup is actually produced
by `renderVals()`, which otherwise fails silently as a blank node.

## Data layer (unchanged by the split)

```
lib/store.js         one API, two adapters (Firebase RTDB / local)
lib/markdown.js      markdown <-> blocks, and the marker map the caret needs
lib/diff.js          block + word level diff
lib/seed.js          demo workspace
lib/firebase-config.js
lib/database.rules.json
```

`requirements.md` remains the specification — behaviour, contracts and the
reasons behind them. This file is only a map.
