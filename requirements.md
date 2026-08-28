# Alamza Notes — Requirements

> **Rule 0 — this file is the single source of truth.**
> Every instruction the user gives must be written into this file. When a new
> instruction changes an old one, **update the old requirement in place** (do not
> append a contradicting line). Every build must be checked against this file.
> Keep it technical and specific. Language of the app and of this file: **English**.

> **Where the code lives: [`ARCHITECTURE.md`](ARCHITECTURE.md).** The app is one
> class whose methods are filed across `lib/part-*.js`. Read that map before
> editing — it says which file owns which area, and carries a method index to
> grep instead of the codebase. This file stays the *specification*; that one is
> only the *map*.

---

## 1. Product

**Alamza Notes** — a block-based writing workspace with nested pages, inline
databases, and first-class **version control** for documents.

The differentiator is versioning: any page can be snapshotted into a named
version, versions can be diffed against each other, and any old version can be
restored (replacing the current page, or as a brand new version).

## 2. Platform & stack

| Concern | Decision |
| --- | --- |
| Entry file | `index.html` — launches `index.dc.html`, which holds the whole app |
| Rendering | Design Component, single streaming file, inline styles only |
| Data | `lib/store.js` — one API, two adapters |
| Default adapter | **Firebase Realtime Database** + Firebase Auth (Google) — `lib/firebase-config.js` holds the `alamza-notes` project |
| Demo adapter | **Local** (`localStorage`, seeded workspace). Offered as **Explore the demo** on the sign-in screen; the choice is remembered until the user leaves it from Settings → Data & sync. |
| Switching | Automatic from the config. A filled config = Firebase; an empty config = local. The demo flag overrides a filled config for that browser only. |
| Libraries (CDN) | `highlight.js` (code syntax), `KaTeX` (math), Firebase JS SDK v10 (modular, dynamically imported only when configured) |
| Fonts | Instrument Sans (UI + content), Instrument Serif (wordmark, display), JetBrains Mono (code) |
| Themes | Light + Dark + System. Persisted per user. |
| Responsive | 100% optimized for desktop **and** mobile. Mobile is **not** a squeezed desktop layout — it has its own shell (§10). |

## 3. Data model

```
User      { uid, name, email, photoURL, provider }
Workspace { id, name, icon, members[] }
Page      { id, parentId|null, icon, cover, title, blocks[], order,
            favorite, trashed, createdAt, updatedAt, updatedBy,
            versions[], share{}, viewers[] }
Block     { id, type, text, indent, checked, collapsed, lang, icon,
            children[], pageId, dbId }
Version   { id, n, message, auto, createdAt, author, title, icon, blocks[] }
Database  { id, name, props[], rows[], views[] }
Prop      { id, name, type: text|select|multiSelect|date|checkbox|person|number,
            options[] }
View      { id, name, type: list|card|table|board, groupBy, filters[], sorts[] }
Share     { published, slug, password|null, invites[{email,role}], role: viewer|commenter|editor }
```

Block types: `p, h1, h2, h3, ul, ol, todo, toggle, quote, callout, divider,
code, math, table, columns, subpage, database`.

Blocks also carry optional `color`, `bg`, `comments[]`, `rows[][]` (table),
`cols[][]` (columns) and `level` (toggle: 1–3 for a heading toggle).

## 4. Pages & nesting

- Unlimited nesting. A page can be written inside another page.
- Every page has an **emoji icon** (picker with search + recents + Remove).
- Sidebar renders the page tree with expand/collapse chevrons.
- `subpage` block embeds a child page inline in the parent; clicking navigates in.
- Breadcrumb shows the full ancestor path.
- Favorites, Shared, Trash sections. Trash supports restore + permanent delete.

**One fact, two records — and they must agree.** A child page is recorded twice:
as `parentId` on the child (what the sidebar tree reads) and as a `subpage`
block in the parent's body (what the page renders). Any path that writes one
without the other produces a page that is visible in the sidebar and invisible
in its parent — and changing the creating code never repairs the pages already
in that state. So `reconcileChildren(pageId)` runs whenever a body is in hand
(on open, and after a body arrives) and appends a link for any non-hidden,
non-trashed child that has lost one. It is deliberately one-directional: it can
only add a missing link, never delete a block, so trash and delete keep sole
ownership of removal. Row pages (`hidden`) are excluded.

## 5. Editor

Notion-class block editor.

- **Slash menu** (`/`) — filterable list of every block type, keyboard navigable.
- **Markdown input shortcuts** while typing: `# `, `## `, `### `, `- `, `1. `,
  `[] `, `> `, ` ``` `, `---`, `$$`. Inside a toggle the hashes set the
  toggle's heading level instead (§5, Heading toggles). The prefix is removed,
  so **the caret moves left by exactly what was removed** — it does not jump to
  the end of the line. Typed in front of an existing "Hello world", `# ` made
  the heading but left the caret at column 11, and everything typed next went
  to the back of the line the reader was standing at the front of.
- **Drag handle** (`⠿`) on hover — drag to reorder blocks.
- **Block hover menu** — Turn into, Duplicate, Copy link, Move to, Delete.
- **Inline marks**: `**bold**`, `*italic*`, `***both***`, `` `code` ``,
  `~~strike~~`, `==highlight==`, `[label](url)`. `___both___` reads the same as
  `***both***`.
- Keyboard: Enter = new block, Backspace at start = merge/downgrade,
  Backspace inside text = one *visible* character (§5.1),
  **Ctrl/Alt + Backspace or Delete = one whole word**, counted the way the
  reader sees it (§5.1),
  Tab / Shift+Tab = indent, Cmd/Ctrl+B/I/E, Cmd/Ctrl+Enter = toggle todo.
- Code blocks: language selector + highlight.js.
  A code block is a **literal container**. Whatever goes in comes back out
  byte-for-byte: paste keeps every newline and blank line, Enter makes a real
  line (carrying the previous line's indentation, plus one level after an
  opening bracket), Tab indents and Shift+Tab outdents, and no markdown
  shortcut or `/` menu fires inside it. ⇧⏎ or ⌘⏎ escapes to a new paragraph
  below. Syntax colour stays on **while the caret is inside the block**, and
  the gutter numbers every line.

  Reading the block back never uses `textContent`: browsers materialise lines
  as `<div>`/`<br>` and `textContent` concatenates them with nothing in
  between, so a pasted file collapsed onto one line and a pressed Enter was
  read back as if it had never happened. The DOM is read the way it renders.

  Speed is a requirement, not a bonus. A keystroke updates the model and the
  gutter and nothing else — no re-render, no re-tokenise, no markdown pass;
  the DOM is read at most once per frame. Re-highlighting waits for a pause
  whose length scales with the file, and above ~120k characters the text stays
  plain rather than slow.

  **One element, one block.** `sc-for` keys its rows by index, so when a row
  leaves the middle of the list React hands the same editable element to
  whichever block now sits at that position. It detaches the old ref before
  attaching the new one, and ignoring that detach left `_els` pointing two
  block ids at one element: `syncDom` then painted it twice, once per id, and
  the last write won. Collapsing a toggle blanked the paragraph *below* it,
  because the toggle's hidden child and that paragraph were sharing a node.
  `elRef` lets go on detach; the id that still owns the element re-registers on
  the same commit.

  The gutter has exactly **one owner**. React renders the span empty and never
  writes its text; the line numbers are painted from the model — on edit, and
  at the top of every DOM sync so undo, restore and language switches repaint
  it too. Two writers to one node would desynchronise React's record of it,
  after which React sees no change to make and the count stays wrong for good.
- Math blocks: KaTeX.
- Toggle blocks: collapsible with nested children. `repair()` keeps at least one
  child on every toggle, so it is never structurally a dead end.

  The gutter's **＋ opens a line inside an open toggle**, not after it. The
  button sits beside the toggle's own title, so the line it opens has to appear
  under that title; putting it after the toggle dropped it below all the
  contents, far from the button that was clicked, and it then did not collapse
  with them. A *closed* toggle shows no inside, so there the next line is a
  sibling, as it looks.

  A toggle must be **escapable by keyboard**, or it is a one-way door: ⏎ used to
  focus `children[0]`, so a toggle with nothing inside consumed the keystroke
  and did nothing at all, and once inside ⏎ only ever made more children.
  Three exits:
  1. **⏎ on a blank toggle** (empty title, nothing written inside) turns it back
     into a paragraph — the same escape ⏎ already gives an empty list item.
     "Blank" has to mean *nothing written inside*, not *no children*, because
     `repair()` guarantees a child exists and a length test would make this
     exit dead code.
  2. **⏎ on a titled toggle** opens — creating if needed — its first child and
     puts the caret there, instead of swallowing the key.
  3. **⏎ on an empty last child** climbs out and lands as a paragraph directly
     after the toggle, the way ⏎ on an empty list item leaves the list.

  `locate()` returns the containing `parent` block alongside the hit, because a
  block nested in a toggle cannot climb out without knowing what it is inside.

  **A toggle that stops being one hands its contents back.** Only a toggle has
  an inside — nothing walks `children` for any other type — so turning one into
  text took its contents off the page *and* out of the markdown export while
  they sat on in the file, whole and unreachable. There are three doors into
  that state (the ⠿ menu's *Turn into*, a markdown shortcut typed in the title,
  and ⌫ at the start), so the rule lives at the one place every mutation
  already passes through, `repair()`, rather than at each of them: a non-toggle
  carrying `children` has them lifted into the list right after it. What was
  inside the toggle becomes what follows it. The blank child `repair()` itself
  guarantees is dropped rather than lifted, so emptying a toggle and turning it
  into text leaves nothing behind.

  **Heading toggles.** A toggle can title a section at heading 1, 2 or 3 — the
  same typography, gutter offset and reader styling as the plain heading of
  that level, with the collapse arrow scaled to match. It is a `toggle`
  carrying a `level`, **not** a fourth block type: `repair()`, the three ⏎
  exits, Tab-to-nest, `flat()`, drag and the markdown writer all key off
  `type === 'toggle'` and go on working untouched. The menus need names for
  the three, so they use the pseudo-types `toggle1`/`toggle2`/`toggle3`, which
  `blockSpec()` unpacks at the single place a block's type is written.
  `setBlockType()` is that place, and it *deletes* the level for anything that
  is not a heading toggle — otherwise a toggle turned into a paragraph and
  back would silently return as a heading.

  Inside a toggle, `# `/`## `/`### ` set the **toggle's own** level rather than
  converting the block. Falling through to the plain heading shortcut would
  drop the toggle's children on the floor, since a toggle is the one block
  whose contents live inside it. Any of the three levels can be swapped for
  any other at any time, and past three hashes there is no heading to mean, so
  nothing happens and the text stays exactly as typed.

### 5.1 Live-preview inline markdown (critical)

The editable DOM **always holds the exact markdown source**. Marker characters
(`**`, `#`, `` ` ``…) are wrapped in marker spans:

- Block **not** focused → markers hidden.
- Block focused → **still hidden**. Nothing ever renders as a raw tag in normal
  view; the page always looks fully rendered, exactly like a WYSIWYG editor.
- **Source view** button → every marker becomes visible for the whole document
  *and* block-level tags appear (`#`, `-`, `- [x]`, `>`, ` ``` `, `$$`, `---`),
  while the formatting itself stays applied.

Because markers live in the DOM as real text, `textContent` round-trips to
lossless markdown. This is what guarantees §5.2.

**Backspace has to know the markers are there.** The character in front of the
caret is not always the character the reader sees: at the end of `**bold**` two
invisible asterisks sit between them, so a plain ⌫ ate a delimiter and the
whole run lost its formatting in one keystroke — press it once at the end of a
bold word and `bold` became a raw `**bold*`. ⌫ therefore deletes the last
**visible** character instead, and when that empties the run it takes the
delimiters with it, so the text falls back to plain rather than leaving `****`
behind. The same map answers the mirror case: when only delimiters lie between
the caret and column 0, the caret visually *is* at the start, so the
block-level ⌫ (merge into the block above / downgrade to a paragraph) runs
there rather than eating the opening marker.

**The caret we park is the caret we mean.** A `display:none` span holds no
caret position at all, so the offset set after a run closes does not survive:
the browser slides it back to the last *visible* spot, which is **inside** the
run. Everything typed next then landed inside the delimiters — `**bold**` plus
a space came back as `**bold more**`, the whole phrase bold; and when the slide
put the caret between the two closing asterisks, a space produced `**bold* *`,
which renders as a literal `*`, an italic run and another `*`. The same slide
made ⏎ split at an offset no reader could see, tearing `**bold**` into
`**bold***` above `*…**`.

So typing never reads the caret back from the browser. An insertion of *n*
characters at *p* puts the caret at *p + n*, which is not a matter of opinion,
and that offset is remembered as `_want`. On the next keystroke, if the browser
inserted somewhere else and **only invisible characters separate the two
offsets**, the two are the same place on screen and the character merely landed
on the wrong side of a marker: it is moved back. Any deliberate move — a click,
an arrow, any key that is not a plain character — drops `_want`, so editing
inside a bold word still extends it, and a caret *navigated* to the end of a run
is inside it and keeps typing bold, the way Word, Docs and Notion all behave.
Only the keystroke that **closes** a run leaves you outside it.

The same reasoning holds at the other edge, and there it needs no `_want`: if
**everything before the insertion is invisible**, the reader was standing at
column 0. `Home` in `**bold** tail` cannot park a caret before the hidden `**`,
so the browser slid it to offset 2 and the next character came back bold, as
`**Xbold**`. Nothing sits to the left of column 0 for formatting to be
inherited from, so the character belongs outside the run — as it does in every
editor.

Structural operations snap out too: `AMD.snapOut()` moves an offset that is
strictly inside a delimiter run forward past it, so ⏎ never splits a pair in
half. Offsets merely *next to* a run are honest positions and are left alone.

**A link is split the way Notion splits one.** `[label](url)` is one word to
the reader but four pieces of syntax to the parser, and only the label holds
caret positions at all. ⏎ inside the label closes the link on the first block
and reopens it on the second, so both halves stay links; ⏎ on either *edge* of
the label keeps the link whole rather than making an empty one; and ⏎ inside
the `](url)` part, where no reader can put a caret, moves past the link.
Nothing else in a label is live — `scan()` does not parse emphasis inside one —
so a `*` or `==` written in there is ordinary text and is never closed or
reopened as a run.

Where a block holds anything invisible, **`⌫` and `⌦` are both ours for every
press**, not only at the edges. Chromium deletes a `display:none` span *together with* the
character beside it: `⌫` over the `m` of `==mark==` took the opening `==` with
it and left the other half showing as literal text. Handing an "ordinary"
character back to the browser was never safe next to a hidden delimiter. A
block with no delimiters in it keeps the native key. `⌦` is the same rule
forwards, and when nothing but delimiters lies ahead the caret is visually at
the end of the block, so the merge-with-the-next-block rule runs there —
`⌦` at the visual end of `one **bold**` joins the block below it.

**A word delete is a word the READER can see.** `**bold**` is four characters
to them and eight to the file, so counting in the source took the delimiters
for letters and stopped mid-run. `⌃`/`⌥` + `⌫`/`⌦` measures the boundary on the
visible projection — skip whitespace, then take the run of word characters (or
of punctuation, if that is what is there) — and then performs that many
*single* steps. Reusing one step at a time is the point: an emptied run drops
its delimiters by exactly the rule one keystroke already follows, so a word
delete cannot leave half a pair behind. When nothing of the reader's is left on
that side it falls through to the single-key branches, which own merging with
the neighbouring block.

**Whitespace never gets trapped against a delimiter.** Deleting the character
at the edge of a run left `**bold **`, which CommonMark does not read as
emphasis — the run broke and its asterisks appeared. The whitespace belongs
outside the run, so it is moved across the delimiter: the reader's words stay
in the same order and the run is whole again. Only the delimiter the deletion
actually touched is considered, and the swap is kept only if `markMap()` says
it genuinely hides more, so it can never quietly turn someone's literal
asterisks into emphasis.

`AMD.markMap(text)` says which character positions are hidden delimiters and
`AMD.backspaceAt(text, at)` applies the rule; both read the same `scan()` the
renderer uses, so what counts as a marker can never drift from what is drawn.
In **source view** the delimiters are visible — they are the reader's to
delete, and this behaviour deliberately stands aside.

### 5.2 Copy = Markdown

Copying any selection or the whole page yields **valid, unbroken Markdown**:
correct heading levels, list indentation, fenced code with language, tables for
databases, `<details>` for toggles, `$$` for math, links for subpages.
"Copy as Markdown" also exists in the page `•••` menu.

### 5.3 Editing model

- **Saving** — a keystroke updates the model immediately and the store on a
  debounce; `readBlock` is the only writer on that path. It compares the DOM
  against what was last **saved**, never against the model, because `onInput`
  has already written the model by then — comparing against it made the guard
  permanently true, and typing alone never reached storage at all. The text
  still arrived whenever some *other* edit (⏎, Tab, a menu, a checkbox) wrote
  the page, which is why the loss stayed invisible: nearly every session
  contains one. Type a sentence and close the tab, and it was gone.
- **Undo / redo** — `⌘Z` / `⌘⇧Z` (and `⌘Y`), covering block operations (turn
  into, move, delete, duplicate) as well as text.

  **Both keys file whatever is still pending before they move.** Typing files
  its history on a 900ms debounce, so a character struck a moment ago is not in
  the stack yet, and `applyHist` overwrites the page wholesale — anything
  unfiled at that moment is simply gone. `undo()` always guarded against this;
  `redo()` did not, and it destroyed that typing outright: undo a step, type,
  press `⌘Y`, and what you typed had never existed. `syncTail()` is a no-op
  when nothing has changed, so a redo with nothing pending walks forward
  exactly as before; when something *has* changed it is filed, which takes the
  forward stack with it — the same rule any new edit follows, and the reason a
  new edit kills redo.

  **The page title is filed like any other edit.** It sits in every snapshot,
  but nothing ever filed one *for* it: `⌘Z` could not take a title back, and —
  worse — undoing anything **else** landed on a snapshot carrying the old title
  and wiped what had been typed since. The state as it stood *before* a run of
  title keystrokes is filed once, the result on a pause, so a whole title is
  one undo step and stopping then typing again gives two. On a database row
  page the title also mirrors into the row's first cell; `patchDb` files
  history on every call, which alone put one entry per **keystroke** in the
  stack, so that write is told not to and the debounce owns the filing for both
  kinds of page. (The mirrored cell itself is not in a row page's snapshot —
  `dbsUsedBy()` only walks blocks, and a row page holds no database block.
  Restoring it wholesale would be the whole-database hazard that delta restore
  exists to remove, so it waits for that.)

  **Neither key writes in a view the reader may not edit** — a version preview,
  a page sitting in the Trash, a published page someone is only reading.
  `_mutate` has always checked `isReadOnly()`; `applyHist` never did, so `⌘Z`
  and `⌘Y` went straight past it into `setState` and edited the document
  anyway. The check sits on the function that **writes**, so no future caller
  can slip past it, and again on the two keys, so nothing is filed on the way
  in and no toast claims an edit that never happened. Leaving the read-only
  view restores both keys immediately.

  **Every writer files the state it is about to leave behind.** `mutate` files
  on *both* sides of a structural change, so such an edit always has a step
  behind it. The writers that go through the DOM — typing, `⌫`/`⌦`, the code
  block — cannot do that, since filing per keystroke would pack the stack with
  single characters, so they file once the reader pauses. That left the run
  itself with no "before": on a freshly opened page the stack was empty and the
  first thing anyone typed could not be undone at all. `histMark()` files that
  "before" exactly once per run — the pending timer is what says a run is
  already under way — and `histLater()` files the result on the pause. The
  timer carries the page it belongs to, so a run still pending when the reader
  navigates away cannot file itself into whatever page is open when it fires.
- **Multi-block selection** — lasso from the gutter beside the text, `⌘A`
  twice for the page, or `⇧↑/↓` out of a block.

  A selection cannot simply *grow* out of its block: each block is its own
  contenteditable element, two of those are two editing hosts, and no browser
  selection spans them — `⇧↓` used to call `focus()` on the next block, which
  collapses the selection, so the gesture threw away everything it had. It has
  to change **kind** instead. Inside a block the browser owns it; at the true
  end of the text `⇧↓` hands over to whole-block selection, which is the same
  `blockSel` the lasso fills, so highlight, copy/cut as Markdown, delete and
  replace-on-typing all already applied to it. The handover waits for the end
  of the *text*, not merely the last visual line, so from mid-block the first
  `⇧↓` still selects the rest of the block and only the next one crosses.
  `_selAnchor` is the end that stays put and `_selHead` the end that moves, so
  `⇧` back the other way shrinks the range rather than growing it the wrong
  way; a pointer press clears both. Blocks that hold no caret — a divider, a
  table — are *included* here, unlike in caret motion, because they are real
  blocks to copy or delete. Escape drops the selection.

  Nothing is focused in this mode, so the browser has no caret to keep on
  screen and the page sat still while the selection ran off the bottom of it.
  The moving end is scrolled into view on every step, by `nearest` — the least
  movement that brings it in — so a selection growing inside the viewport does
  not jerk the page around. The lasso rectangle is anchored in **document** space and
  auto-scrolls at the edges, so a selection keeps growing as you scroll through
  a long note. Copy/cut writes Markdown; typing replaces the selection; the drag handle moves
  the whole selection.
- **Floating format bar** on any text selection: bold, italic, strike, code,
  highlight, link, colour. With **nothing** selected, `⌘B`/`⌘I`/`⌘E`/`⌘U`/`⌘H`
  take the word under the caret — the only reading of "bold this" available
  when there is no selection, and what a word processor does. The word stops
  at whitespace *and* at any delimiter, so `⌘B` inside `**bold**` offers
  `bold` and the toggle strips the pair, rather than wrapping the asterisks
  themselves. `⌘B` on an *italic* word gives `***word***`, which is bold and
  italic together. With no word under the caret the key does nothing:
  wrapping an empty range wrote `****`, four asterisks the reader can see,
  since a run with nothing inside it is not emphasis and renders as the
  literal characters it is.
- **Triggers anywhere in a line** — `/` for blocks, `@` to link a page. Both
  remove the typed query when a command is chosen or Escape is pressed.
- **Block motion** — `⌘⇧↑/↓` move, `⌘D` duplicate, `⌘⇧⌫` delete.
- **Caret behaviour** — Backspace at the start merges into the block above,
  Tab under a toggle nests the block into it, and `↑/↓` carry a **goal
  column**: the column the caret set out from is held for the whole run of
  presses, so crossing a short line and carrying on lands back under where you
  started. Any other key, or a pointer press, drops it — a click places the
  caret deliberately, and holding the old column would yank the next `↓` back
  to wherever the caret had been travelling before.

  `←/→` **cross block boundaries** at the edges: at the very start of a block
  `←` lands at the end of the one above, at the very end `→` lands at the
  start of the one below. Each block is its own contenteditable element, and
  to the browser two of those are two separate documents, so its caret motion
  stops dead at the boundary and the only ways across were the mouse and
  `↑/↓`. "The very end" means what the **reader** sees: typing `**bold**`
  leaves the caret between the two closing asterisks — inside a `display:none`
  span, with no rect of its own — and from there the browser could not move it
  at all, so `→` did nothing for ever from a position one bold word reaches.
  Everything between the caret and the end being a hidden delimiter is the
  end, the same way `⌫` reads the other edge. Mid-text needs no help: the
  browser steps over a whole marker run in one press. Held modifiers and `⇧`
  are left alone — word jumps and selection belong to the browser.

  `↑/↓` and `←/→` both **step over what cannot hold a caret**. A divider, a table, a
  sub-page and a database have no editable element between them; asking for
  exactly one neighbour and giving up when it was one of those made a divider
  a wall, with everything beyond it unreachable by keyboard on a page that
  opens with one. Two measurements make this work: a collapsed range has no
  bounding box (Chromium answers with zeroes), so the "last visual line?" test
  reads `getClientRects()`; and its tolerance comes from the caret's own
  height rather than a flat 6px, which was less than the padding under a
  single line and so answered no for every caret that was not already at the
  end of the text.
- **Drag & drop** — pointer-driven: a floating ghost, an insertion line that
  springs to the nearest gap, auto-scroll near the edges, and the dropped block
  adopts the target's list indent. A block can never be dropped inside itself.
- **Per-block colour and background** from a ten-colour palette.
- **Block comments** — threads in a side panel with resolve, plus a count bubble
  in the gutter.
- **Block anchors** — "Copy link to block"; arriving at the link scrolls to it
  and flashes it.
- **Change markers** — with *Show changes since last version* on, every block
  added or edited since the latest snapshot gets a `+` / `~` in the gutter;
  clicking it opens the diff.
- **Read-only safety** — while previewing an old version nothing can write to
  the live note (checkboxes, toggles and inserts are inert).
- Blocks also include a plain **table** and **2- / 3-column layouts**; both
  serialise to valid Markdown and render in the public reader.

## 5b. Data & sync

One API, two adapters (`lib/store.js`). Local/demo keeps a single flat blob in
`localStorage`, everything inline. Firebase mode uses the Realtime Database,
shaped around the one number that plan bills:

> **RTDB charges for bytes DOWNLOADED (10 GB/month) and stored (1 GB).
> Uploads are free.** Every decision below follows from that.

```
workspaces/<uid>/
  meta                    prefs · workspace · invites
  idx/<pageId>            ~110 B  title, parent, order, flags   ← SUBSCRIBED
  dbmeta/<dbId>           props, views, row order               ← SUBSCRIBED
  dbrev/<dbId>            ~60 B row-change ping                ← SUBSCRIBED
  body/<pageId>           blocks           · fetched on open
  dbrow/<dbId>/<rowId>    one row          · fetched on first view
  dig/<pageId>            search keywords  · fetched on first search
  vmeta/<pageId>          snapshot metadata (incl. precomputed +/− stat)
  vdata/<pageId>/<vId>    snapshot bodies  · write-once, cold
  dbs/<dbId>              — removed; replaced by dbmeta + dbrow
```

### The five rules

**1. One listener per path, ever.** `init()` is single-flight and `subscribe()`
is idempotent per uid; every handle is kept and released on sign-out or uid
change. This is not a nicety — `onChildAdded` replays every existing child to
*each* attached listener, so a duplicated subscription is a duplicated download
of the whole collection, and it compounds. `onAuthStateChanged` fires again on
every hourly token refresh, and the app retries `init()` while the SDK is still
importing, so both entry points must be guarded.

**2. Never listen to a path you write.** Only the index and the two ping nodes
are subscribed, and every entry carries a writer id (`w`) *inside the object* —
self-authored echoes are dropped without a read.

**3. A node is the atomic read unit, so split by change frequency.** Page text
left the index; database rows left the table. Anything that changes often must
be small, and anything large must change rarely.

**4. Nothing loads until it is needed.** Startup is the index alone. Bodies,
rows, digests and snapshot bodies are separate fetches, each cached. `null`
means "not fetched" and is never rendered as empty — `bodyReady()` /
`rowsReady()` gate every write, so an edit can never serialise absence over
real data. An unfetched page or table shows a skeleton sized from the index's
own block/row count, with its real title and count already correct.

> **`null` is not `[]` — the trap this layout creates.**
> Before the split, every page in state always carried real blocks, so idioms
> like `(blocks || []).filter(…)` were safe. They are now data loss: a
> workspace-wide rewrite (trashing a page, dragging one in the sidebar) walks
> *every* page, and turning a never-fetched `null` into `[]` marks that page
> loaded-and-dirty — the next push writes the empty array over its real body.
> With 37 notes and one open, a single trash would have blanked 36.
>
> Three rules keep it safe, and any new code touching bodies **or table rows**
> must follow them:
> - **Rewriting helpers preserve `null`** (`strip`, `stripSubpage` return `null`
>   unchanged). A body we do not hold cannot contain a live subpage block, and
>   any stale reference is cleaned next time that page is opened and saved.
> - **Inserting into a parent requires its body.** `needParent()` fetches it
>   first and re-runs the operation; the insert sites additionally refuse to
>   touch a parent whose `blocks` is still `null`, so a sub-page link can never
>   become a page's only block.
> - **`push()` refuses a suspicious blank.** If a body was never fetched this
>   session and now presents as `[]` while the index says it had blocks, the
>   write is skipped rather than trusted.
>
> **The same trap exists for database rows, with a different casualty.** A
> missing `dbrow/<dbId>` node must resolve to `null`, not `[]` — `migrate()`
> writes `dbmeta` before the rows (in separate bounded updates), so there is a
> real window where the schema exists and the rows do not. Accepting `[]` there
> would let `push()` write `o: []` over `dbmeta`, and `o` is the *only* place
> the manual drag order is stored: the rows themselves would survive
> (`fromDbMeta` re-appends any row missing from `o`) but the order would be
> silently and permanently gone. So `loadRows()` returns `null` for an absent
> node, exactly like `loadBody()`, and `ensureRows()` accepts an empty table
> only when the index agrees `rowCount` is 0 — which is what lets a genuinely
> new table resolve instead of loading forever.
>
> Anything that serialises a page — Copy as Markdown, deep duplicate, export —
> fetches bodies (and table rows) first rather than emitting a heading with no
> content, or cloning a page that `push()` would then skip entirely.

**5. Meter what you are billed for.** `AStore.stats.down` counts **every**
listener callback and every explicit read, broken down by node kind, and is
shown in Settings → Data & sync. The previous counter measured only explicit
reads, which is exactly why a listener leak pulled hundreds of megabytes while
the readout said almost nothing.

### Database rows

A cell edit writes one `dbrow` node and one ~60 B `dbrev` ping. The peer reads
the ping, and refetches **only the named row** — or, if several rows moved,
drops its row cache and reloads on next view. Row *order* lives in `dbmeta.o`
as an array of ids, so a drag-reorder is one small write and the rows
themselves never move.

### Caching

Bodies and rows share one ~2.4 MB `localStorage` LRU, so reopening recent work
is free. The cap exists because `localStorage` is ~5 MB and a workspace may be
far larger — it holds the working set, not the corpus. Local/demo mode never
writes these caches: the flat blob is its only truth.

**Two-tier debounce.** 240 ms to `localStorage` (free, survives refresh); 2.2 s
to the network, plus blur, tab-hide and unload. Each push is one multi-path
`update()` of only the dirty subtrees — a page never opened or a table never
viewed is skipped entirely, since it cannot be dirty.

### Known limits

- Full-text search over never-opened notes matches the 600-character digest,
  not the whole body. Search is rare in this app; a true full-text index would
  be a separate build.
- Exports are the one operation that legitimately wants the whole corpus. They
  fetch bodies **and** table rows explicitly, with a progress toast.

### Migration

Workspaces move onto this layout on first load. Two rules, both learned from
failures:

1. **Never put an ancestor and its descendant in one multi-path update.**
   Firebase rejects the *entire* update, so nothing migrates, the index stays
   empty, and the app shows a workspace with no pages while the real data sits
   untouched. Writer ids go *inside* the object.
2. **Never read or write the whole corpus at once.** Pages stream 20 at a time,
   tables 4 at a time with rows in 40-row updates, so peak memory and each
   write stay bounded and the user sees progress. Old nodes are cleared only
   after everything is copied, in their own update.

`dbmeta` — not `idx` — is the marker for this layout, because the previous
layout also wrote `idx` and still needs the database split. A migration in
flight is tracked with a **synchronous** flag, set before the async work
begins: `onAuthStateChanged` can fire twice before the first migration settles,
and two concurrent migrations would double the one-time read this refactor
exists to avoid. A failed migration **must not look like an empty account**:
`ensureLayout()` returns a status, and stranded data raises a "your notes are
safe" banner with Retry.

**Completion is recorded, not inferred.** A durable `layout: <version>` stamp
at its own top-level path is what says "migrated", checked first on every boot
for the cost of one tiny read. It must not live under `meta`, because `push()`
rewrites that node wholesale and would erase it. The stamp is written **before**
the old-node cleanup, since the migration is complete once every page and table
has been copied — whether or not the leftovers can be removed. Inferring
completion from "the old nodes are gone" was a severe bandwidth bug: cleanup is
best-effort by design, and when it failed every single page load re-migrated the
entire workspace, re-reading every body forever.

### Three states, not two

"Signed in but the index has not arrived" is distinct from both "still booting"
and "this workspace is empty". `AStore.ready` only means the SDK loaded, so it
cannot tell them apart — and getting it wrong tells a returning user on a new
device that their workspace is empty, with a New page button that writes a stray
page into a workspace full of real notes. `AStore.indexReady` resolves the third
state: true immediately when a cached index is already painting or when `idx` is
confirmed absent, otherwise on the first `idx` child (with an 8 s floor so a
dead connection cannot strand the user on a skeleton). Both the sidebar's "No
pages yet." and the document pane's empty state are gated on it, showing
skeletons until then.

Security rules live in `lib/database.rules.json` — a workspace is readable and
writable only by its own `uid`.

## 6. Version control (headline feature)

**Model** — the *current* page is the live working document. It auto-saves
continuously; opening a note always opens the current state.

**A version is a snapshot of a SUBTREE, not a page.** If a page has two child
pages and one of those has a child of its own, taking a version captures all
four, plus every database any of them embeds. Anything less is a version that
never existed: restoring it would leave the nested pages at their newest state
while the parent went back in time.

**Storage** — metadata and payload live apart, because they have opposite
access patterns:

```
vmeta/<pageId>          the version LIST — n, message, author, createdAt,
                        stat, deepStat, scope[]  · read when a page opens
vdata/<pageId>/<vId>    the PAYLOAD — { b, d, p }  · read only when a version
                        is opened, diffed or restored
```

The payload is `b` (root blocks), `d` (databases used anywhere in the subtree)
and `p` (every descendant, keyed by page id, each with title, icon, parent,
order and blocks). `scope[]` in the metadata is a title-only manifest, so the
diff can list the nested pages without fetching anything. Snapshots written
before deep capture are a bare block array and are normalised on read by
`normSnap()` — never special-cased at the call sites.

**vmeta must be READ, not just written.** It is its own node, so a page whose
metadata has not been fetched presents as `versions: []`. That is the
null-vs-empty trap again, and here it is fatal: the empty list would be pushed
straight back over the real one and the history would be gone for good. Two
defences — `ensureVersionMeta()` fetches it whenever a page opens, and `push()`
refuses to write an empty version list for a page whose metadata was never
confirmed (`vmetaSeen`). A list fetched from the server never overwrites one
authored in this session.

`openPage` is **not** the only way a page becomes current — boot resolves the
first page directly, a remote delta can re-point `pageId`, and the versions
panel can open on a page that arrived either way. All four sites call it
(`syncVersionMeta()`); missing them left the most travelled path of all, the
page the app opens on, showing whatever stale list the mirror happened to hold.

**Capture is all-or-nothing.** Every body and every table in the subtree must
be in hand before a snapshot is authored — a page still loading would be
captured empty, which is how a version silently "doesn't store the changes".
`createVersion()` prefetches, then re-runs itself. It also waits for the
*previous* snapshot, because that is the baseline for the message and the +/−
stat; diffing against a snapshot that has not loaded reports the entire page as
newly added, and that wrong history cannot be recomputed later. A lock is held
across the whole author, since two calls in one tick would both read the
pre-commit list and the second would discard the first.

**A snapshot with nothing new is refused.** Identical content clutters the
history and makes every diff against it read "identical", so `createVersion`
rejects a capture where neither the root nor any nested page moved and nothing
was deleted. The **first** snapshot on a page is the exception — it establishes
the baseline. The dialog says so up front and drops its Save button rather than
failing on click, and the pending-changes readout counts the whole subtree, so
a nested-only edit never reads as "nothing to snapshot".

**One builder, one set of numbers.** `buildSnapshot(rootId, prevSnap)` produces
the payload, the root stat, the deep stat and the scope manifest. Both callers
— `createVersion` and restore's safety snapshot — go through it. They used to
build snapshots separately, and the copies drifted: the safety snapshot
hardcoded `{added:0, removed:0, changed:0}` and omitted `touched`/`gone`, so it
reported no nested change for a subtree that had really moved. A stat cannot be
recomputed after the fact, so a wrong one is permanent — which is why there is
exactly one place that computes it.

**A stat needs a real baseline.** Every path that records one waits for the
previous snapshot to load first. Computing against an in-flight snapshot means
diffing against `[]`, which reports the whole page as newly added — a page that
had not changed since v3 was recorded as "+8 added".

**Version numbers are identity, not position.** `nextVersionN()` takes
`max(n) + 1`. `versions.length + 1` collided as soon as any snapshot had been
deleted: remove v2 of three and the next capture is a second v3, making every
"restore v3", "since v3" and diff label ambiguous.

**Deleting a snapshot deletes its payload.** The metadata and the payload live
in separate nodes (`vmeta` / `vdata`), so removing the row alone left the body
stored and re-downloaded forever with nothing referencing it — the same orphan
class as an unreferenced database. `dropVersionBlocks()` clears the node and the
memo cache.

**Creating a version**
1. User clicks **New version**.
2. A dialog asks for an *optional* message.
3. If the message is blank, the app **generates a meaningful message itself**
   from what actually changed (e.g. *"Added 2 headings, rewrote intro"*).
   Nested edits are named too: a snapshot whose root is untouched reads
   *"Changes in 2 nested pages"* rather than *"No content changes"*.
4. That message is attached to the **state being closed** — i.e. it describes
   the version just archived.
5. The archived snapshot is pushed onto the version list; the user continues
   editing the current document, which is now the next version in progress.

**Version list** — right panel / mobile sheet. Shows `v3 · message · author ·
relative time`, plus an always-present **Current (unsaved)** row. A snapshot
that reaches past its own page carries a `+N nested` badge.

**A fresh snapshot must not be clobbered by its own echo.** `project()` rebuilds
every page's `versions` from `remote.vmeta`, so writing a snapshot without
updating that in-memory index meant the next `emit()` — triggered by the echo of
that very write — handed the app the previous list, and the snapshot vanished a
moment after appearing. Both write paths now keep `remote.vmeta` in step
(`mirrorNow` at 240 ms, `push` at 2.2 s), and `onRemote` never adopts a shorter
version list than the one already in state — deletion has its own path.

**Diff viewer**
- Compare any two versions, or any version against Current.
- **Nested pages are diffable.** When either side spans more than one page, a
  rail lists the whole subtree with per-page `+/−` counts; selecting a page
  diffs that page. The first changed page is selected by default, so the rail
  opens on something worth reading. On mobile the rail becomes a horizontal
  chip scroller above the content — a 216px sidebar eats half a phone — the
  modal goes full-bleed, the header title drops, and the two version selects
  share a row of their own.
- **Toggle between two modes**: *Side-by-side* (old left, new right) and
  *Inline* (single column, additions green, deletions struck red).
- **Granularity: both** — block-level markers in the gutter (`+`, `−`, `~`)
  **and** word-level highlighting inside changed blocks.
- Diff summary header: `+N blocks · −N blocks · ~N changed`.

**Restore** — opens a dialog with three choices:
1. **Replace current** — current content is overwritten by the old version.
2. **Restore as new version** — history preserved; the old content becomes the
   new current. The safety snapshot it takes first is equally deep, is built by
   the same builder, and waits for the previous snapshot so its stat is real.
3. **Open read-only** — just look at the old version, no writes.

**Read-only obeys the null-vs-empty contract.** A snapshot whose payload is
still in flight renders through `vblocks()`, which returns `[]` — so without a
loading state the preview reads as "this version was blank", with a Restore
button beside it. `bodyLoading` covers the read-only case and shows the same
skeleton a cold page body does.

**The history panel prints no counts it cannot stand behind.** The legacy
fallback for snapshots written before `stat` existed runs only when both sides
are loaded; otherwise the row shows no numbers rather than "+0 −0" (two cold
sides) or the whole page as added (one cold side). The nested badge reports how
many nested pages actually *changed* (`deepStat.touched`), not how many exist.

Restore rewrites the whole subtree in one state write: root, every captured
child, and any child deleted since the snapshot, which is **recreated** —
otherwise the restored parent links to nothing. Pages created *after* the
snapshot are left alone; deleting them would make restore destructive in a way
nothing warned about.

**The diff obeys the null-vs-empty contract too.** A nested page whose body has
not been fetched is `null`, and diffing that against a real snapshot reports
every block in it as deleted — a destructive-looking history for intact pages,
with a Restore button directly beneath. `openDiff()` prefetches the current-side
body for every page in the union scope, and until one lands that page is marked
**pending**, not empty: the rail shows `···` instead of counts, the header reads
"comparing…", and the pane shows a loading state rather than running the diff.
A page whose index `blockCount` is 0 is the only case that may legitimately
diff as empty. This matters continuously, not just on first open — `onBodyStale`
drops cached bodies whenever another device edits, so a correct diff can flip
to "everything deleted" mid-session without it.

## 7. Inline databases

A `database` block inside any page. Views: **List, Card/Gallery (with cover),
Table, Board (grouped by a select property)**. View switcher tabs + `+ New`.

Property types: text, select, multi-select, date, checkbox, person, number.
Filter and sort controls per view. Rows open as pages.

### 7.1 Properties — the full Notion model

**Shape.** `prop = { id, name, type, options[] }`, where an option is
`{ id, name, color }`. Options own their colour, are renamed / recoloured /
reordered in place, and renaming one rewrites every row that used it. Databases
that stored options as plain strings are upgraded on read.

**Types.** Basic — Text, Number, Select, Multi-select, Status, Date, Person,
Checkbox, URL, Email, Phone. Automatic — Created time, Created by, Last edited
time, Last edited by. **Several properties may share a type**; the title
property is always first and can never be retyped or deleted.

**Three menus, matching Notion:**
1. **Properties panel** — one row per property with a drag-order pair, the type
   glyph, the type name, and an eye toggle. Plus *Hide all*, *Show all*,
   *New property*.
2. **New property** — searchable type picker grouped Basic / Automatic; picking
   a type creates the property and drops straight into its editor.
3. **Property editor** — name field, `Type ›` submenu, and for the option types
   an inline option list: colour swatch (opens the ten-colour picker), editable
   name pill, reorder arrows, delete, and a "type a name, press Enter" row.

**Retyping keeps data usable** — converting to select/multi-select/status seeds
the option list from the values already present; single ⇄ multi converts
scalar ⇄ array; number coerces.

**Visibility is per view *and* per page.** A view hides properties through its
own `hidden[]`; the page hides them through `pageHidden[]`. Both are reachable
from the property editor ("Hide in this view" / "Hide on the page").

**On a row page** the properties sit in a **collapsible panel**. The collapse
state is stored on the page, so once closed it stays closed. Each property name
is a button that opens its editor; hidden ones are revealed by the
"N hidden" toggle.

**Manual order.** Rows are dragged **by the row itself** — press and drag any
row in list, gallery, table or board; a press that never moves stays a click.
The insertion indicator is horizontal in list, table and board, and **vertical
beside a card** in gallery, where cards flow left-to-right. Edge auto-scroll
runs on both axes (clamped to the viewport) so off-screen targets are
reachable, and the reorder animates with FLIP — the rows above and below slide
to make room. The order is the order of `db.rows`, so it survives reload.
Choosing a property in the sort menu suspends manual order; **Manual (drag
rows)** restores it.

**Drag is measured once, never re-measured.** Container and row geometry is
snapshotted on the first move and every later decision — which column, which
seam, how far each neighbour slides — is arithmetic over that snapshot, with
scroll offsets subtracted. Nothing hit-tests the moving DOM, so the shift can
never feed back into itself. Rows are pointer-inert while a drag is live
(`:hover` transforms are `!important` and would otherwise beat the shift), the
committed drop is the index the indicator was showing, and Escape cancels.

### 7.2 Database chrome

- **Name and icon** are editable from the database header — click the icon for
  the emoji picker, click the name for the settings menu.
- **Views**: a `＋` adds one; double-click or right-click a tab to rename it,
  change its layout, pick its group-by, **Set as default view**, duplicate or
  delete it. The default view is starred and is the one that opens.
- **Database settings** carry **Start with properties collapsed**, so new row
  pages open folded (the default) without folding each one by hand.
- **Filter** is grouped by property with real colour chips, and understands
  checkbox properties. **Sort** offers Manual plus per-property asc/desc.
- **Duplicating** a page that holds a database clones the database whole: new
  database id, new view ids, new row ids, and every row page that had been
  opened is cloned and re-pointed — two fully independent copies.
- **A version of the page is a version of the data.** Snapshots store the
  embedded databases too, and previewing an old version reads that snapshot's
  rows rather than the live table.

### 7.3 A row is a note

Opening a row navigates to a real page: its own blocks, nested sub-pages,
version history and sharing. Properties sit in a list under the title and the
title syncs back to the database. Row pages are excluded from the sidebar tree
(they belong to their database) but appear in breadcrumbs.

## 8. Sharing

- **Publish to web** — read-only public reader view with its own clean layout.
- **Invite by email** with roles: viewer / commenter / editor.
- **Link with password** option on published links.
- **Presence**: "who's viewing" avatars + `Last edited by X · time`.
- **Copy link** button on desktop; native-style **share sheet** on mobile.

## 9. Settings

Full-page settings with sections: **Account** (Google sign-in/out, profile),
**Appearance** (Light / Dark / System, font size, full width), **Editor**
(source view default, spellcheck, small text), **Versions** (auto-version
interval, retention), **Data & sync** (adapter status: Firebase vs Demo,
project id, **Leave the demo and sign in with Google**, export JSON / export
Markdown, import), **Shortcuts**, **About**.

### 9.1 Sign-in screen

Two ways in:
1. **Continue with Google** — real Firebase Auth, syncs to the Realtime Database.
2. **Explore the demo** — switches to the local adapter on a seeded workspace.
   Nothing is written to Firebase, sharing links are simulated, and the mode is
   remembered. Leaving the demo clears the flag and reloads into real sign-in.

With a Firebase project configured the app never fakes a session: the user must
sign in or pick the demo.

### 9.2 Sign-in failures are explained, never swallowed

A failed Google sign-in must **never** show a generic "cancelled" toast. The
screen renders a red panel naming the real Firebase error code and the exact fix:

| Firebase code | Panel says |
| --- | --- |
| `auth/unauthorized-domain` | "This domain is not authorised" + the current hostname in a copyable field + *add it under Authentication → Settings → Authorised domains* |
| `auth/popup-blocked`, `auth/operation-not-supported-in-this-environment` | "The sign-in popup was blocked" + *open `index.html` in its own tab, or use the demo* |
| `auth/configuration-not-found` | "Google sign-in is not enabled" + *turn the provider on under Authentication → Sign-in method* |
| `auth/network-request-failed` | "No connection to Firebase" |
| `auth/popup-closed-by-user` | "Sign-in was closed" |

**Redirect fallback.** When the popup cannot open — a sandboxed preview frame, an
in-app browser — the store retries automatically with `signInWithRedirect`, and
`getRedirectResult` is consumed on boot so the user lands signed in. The button
reads *Opening Google…* while a sign-in is in flight.

**Deployment note.** Google auth only works on a hostname listed in the Firebase
console's authorised domains. `localhost` is authorised by default; a preview or
staging origin must be added by hand. The demo needs none of this.

## 10. Mobile UI (purpose-built, not a resized desktop)

Trigger: viewport width < 860px.

- **Compact header** — back chevron, breadcrumb chip (tap → page stack sheet),
  page emoji + title, `•••`.
- **Card-stack navigation** — entering a nested page pushes a card; swipe-right
  or the chevron pops it.
- **Bottom command bar** (floating, 5 slots): `Pages · Search · ＋ Insert ·
  Versions · More`. Each opens a **bottom sheet** with a drag handle.
- **Insert sheet** — grid of block types with icons, thumb-reachable.
- **Format strip** — appears docked above the keyboard when a block is focused;
  horizontally scrollable: B / I / code / link / H1-H3 / list / todo / indent.
A slim bar at the top of the app announces demo mode and offers the way back
(`AStore.leaveDemo()`), because swapping the whole workspace for seeded pages
is otherwise indistinguishable from having lost every note. On a phone the
message and a 44px button cannot share one 41px row, so the bar stacks — the
exit is the only recovery affordance from that state and must not drop below
the 44px floor.

- **Long-press a block** → action sheet (Turn into, Duplicate, Move, Delete).
- All hit targets ≥ 44px. Sheets are dismissible by drag-down or backdrop tap.

**Home screen (`main: 'home'`)** — the phone's entry point, reached by the back
chevron from the top-level page. Two modes, because they answer different
questions:

- **Browsing** — the page tree, in the same shape as the desktop sidebar:
  indented rows, a disclosure chevron only where a page has children, and
  `N pages inside` on a collapsed branch. It shares `state.expanded` with the
  desktop tree, so expansion is one fact rather than two. The chevron and the
  row body are **separate hit targets** (44×44 and 52px tall) — expanding must
  never force the page open. A leaf keeps the chevron column so the indentation
  cannot lie about depth. Hidden (database-row) and trashed pages are excluded.
- **Searching** — a flat list of matches, newest first, because a tree would
  hide the very results being looked for. Each hit names the page it sits inside
  (`in Meeting notes`, or `Top level`) to replace the context the tree gave.
  Search reads the index digest for notes whose bodies were never downloaded,
  so an unopened note is still findable.

The note count always reports the whole workspace — collapsing a branch does not
mean those notes stopped existing.

## 11. Copy tone

Plain, precise, quietly technical — written for people who like version control.
No exclamation marks, no mascot voice. Empty states state the next action.

## 12. Visual system

| Token | Light | Dark |
| --- | --- | --- |
| canvas | `#FFFFFF` | `#191919` |
| surface | `#FFFFFF` | `#252525` |
| sidebar | `#F7F7F5` | `#202020` |
| border | `#E9E9E7` | `#2E2E2E` |
| text | `#37352F` | `#D4D4D4` |
| muted | `#787066` | `#9B9B9B` |
| accent | `#2383E2` | `#529CCA` |
| hover | `rgba(55,53,47,.06)` | `rgba(255,255,255,.055)` |
| row (selected) | `rgba(55,53,47,.08)` | `rgba(255,255,255,.08)` |
| diff-add | `#EDF6EE` / `#2A7A45` | `#1B2E22` / `#6BBF85` |
| diff-del | `#FBECEB` / `#B3382C` | `#33211F` / `#E08078` |

Radii 3 / 4 / 6 / 8 — Notion's scale, not the softer 10–16px of generic web UI.
Shadows are a hairline ring plus a soft drop, never a coloured glow. Emoji are a
first-class UI element (page icons, callouts). The **default** page icon is a
drawn outline glyph inheriting `currentColor`, so it reads in both themes and
signals "no icon chosen" — it never appears in the page body.

---

## 13. Files

```
index.html              entry point → redirects to index.dc.html
index.dc.html           the entire application (shell, editor, versions, DB, mobile)
lib/firebase-config.js  the alamza-notes Firebase web config
lib/database.rules.json Realtime Database security rules — a workspace is
                        readable and writable only by its own uid
lib/store.js            data layer — local ⇄ Firebase adapters behind one API
lib/markdown.js         inline tokeniser, block→Markdown, Markdown→block
lib/diff.js             block LCS + word LCS + auto change-summary
lib/seed.js             demo workspace (pages, versions, roadmap database)
requirements.md         this file
```

## 14. Build tweaks

The root component exposes four props so the design can be previewed without
editing code: **Force the mobile shell**, **start theme** (light/dark),
**skip the sign-in screen**, and **accent colour**.

## 15. Open backlog

Everything from the 2026-08-02 editor audit has shipped. What is left:

| # | Item | Status |
| --- | --- | --- |
| — | **Image and file blocks** (drag-and-drop, resize, captions) | **Not planned.** The workspace lives in Realtime Database and there is no file storage. Revisit only if Cloud Storage is added. |
| 1 | Synced blocks / block references — the same content in two places | Idea |
| 2 | Focus mode — hide the sidebar and chrome, centre the column | **Shipped** 2026-08-03 |
| 3 | Word count and reading time in the page menu | **Shipped** 2026-08-03 |
| 4 | A "Saving… / Saved" indicator beside the breadcrumb | **Shipped** 2026-08-02 |
| 5 | Command palette that fuzzy-matches headings as well as pages | **Shipped** 2026-08-03 |
| 6 | Code block line numbers | **Shipped** 2026-08-03 · always shown 2026-08-04 |
| 7 | Keyboard navigation inside table cells (Tab / arrows between cells) | **Shipped** 2026-08-03 |

## 16. Change log

Only structural turning points are kept. Individual bug fixes live in the spec
sections above, which are always current.

| Date | Change |
| --- | --- |
| 2026-08-23 | **⌃/⌥ + ⌫ or ⌦ did not remove a word, and a delete could trap whitespace against a delimiter.** In a plain block the browser's own word delete worked; in a formatted one our delimiter-aware branch took the key and removed exactly ONE character, so the shortcut looked broken wherever there was formatting — and the ⌥ chord did nothing at all. The browser could not simply be left to it: it takes a `display:none` span away with the character beside it, and it counts delimiters as letters, so it stopped mid-run. A word is now measured on what the reader SEES and performed as that many single steps, so an emptied run drops its delimiters by the rule one keystroke already follows. Sweeping every offset then exposed an older fault in that single step: deleting the character at the edge of a run left `**bold **`, which is not emphasis by CommonMark, so the run broke and its asterisks appeared — a plain ⌫ had this too and no earlier sweep had used a run with a space in it. Whitespace is now moved across the delimiter rather than left inside, keeping the reader's words in the same order; only the delimiter the deletion touched is considered and the swap is kept only if `markMap()` says it hides more, so literal asterisks are never quietly turned into emphasis. `backspaceAt`, `deleteAt` and both word deletes now share one single-step primitive and one collapse rule, so they cannot disagree. Verified: word delete forwards and backwards over plain text, over runs, and emptying a run or a link label; ⌃⌫/⌃⌦ swept at every offset of three formatted lines and single ⌫/⌦ swept over a run containing a space, with no delimiter ever visible; the block-merge edges and the code block's native key intact. |
| 2026-08-23 | **Two caret faults left over from the audit.** (1) **A markdown shortcut threw the caret to the end of the line.** `tryShortcut` always restored it at `rest.length`, which is right by accident on an empty line and wrong on one that already had text: typing `# ` in front of "Hello world" made the heading but put the caret at column 11, so everything typed next went to the back of the line the reader was standing at the front of. The caret now comes from where the reader actually was, minus the prefix that was removed. (2) **Typing at the visual start of a run came out formatted.** `Home` in `**bold** tail` cannot park a caret before the hidden `**`, so the browser slid it to offset 2 and the next character came back as `**Xbold**`. The relocation already knew the mirror case through `_want`; this edge needs no `_want` at all, because if everything before the insertion is invisible the reader was at column 0 by definition, and nothing sits to the left of column 0 for formatting to be inherited from. Verified: all six shortcuts keep column 0 and what follows is typed at the front; all five run types type plain at the visual start, by `Home` and by arrowing there; and typing inside a bold word still extends it. |
| 2026-08-23 | **`snake_case_name` came out as `snakecasename`.** An underscore inside a word was read as emphasis, so the middle of an identifier turned italic and both underscores were *hidden* — a reader writing about `file_name.txt` or `do_this_now` watched their own text silently rewritten, and the missing characters were invisible rather than wrong-looking, which is worse. CommonMark forbids intraword `_` for exactly this reason; the scanner now does too, for `_`, `__` and `___` alike, emitting the whole run as ordinary text when a word character sits against either end. Asterisks are deliberately untouched — `a*b*c` is emphasis by that spec and everywhere it is implemented. `openRuns()` learned the same rule, because it had the mirror-image fault: ⏎ in the middle of `snake_case_name` closed a run that was never open and produced `snake_c_` above `_ase_name`, inserting underscores nobody typed. Verified: identifiers read back whole, typed key by key as well as loaded; `_really italic_` beside `my_var` still italicises only the former; `_lead_` and `__strong__` still mark; ⏎ inside an identifier adds nothing; ⌫ removes exactly one character at every offset of one; and `inline()` is still byte-identical on all 31 earlier cases. |
| 2026-08-23 | **`***both***` showed its own asterisks.** Bold-italic is the one mark written with three delimiters, and the scanner had no rule for it: the `**` alternative matched `***both**`, took two delimiters off the front and two off the back, and left the third `*` at each end as ordinary text — so the reader typed `***both***` and got `*both*` set in bold, the syntax showing through in the middle of a sentence. Rather than reorder the alternation (every capture group in it would shift, and the group numbers are what the scanner reads), the `**` branch now recognises the case it is already sitting on: a match whose content opens with a *third* delimiter and which is followed by one more takes three from each end and emits a `strongem` segment, rendered `<strong><em>`. `___both___` goes the same way. `****x****`, `***a**b*` and `*** x ***` are deliberately left as they were — none of them is bold-italic. The whole point of one shared `scan()` holds: `markMap()` reads the same segments, so ⌫, ⌦, ⏎ and the arrows all learned the three-delimiter run for free. `⌘B` on an *italic* word is the reward — it produces `***word***`, which used to be a way to make asterisks appear on screen. Verified: bold-italic really paints at weight 700 and `font-style: italic`; ⌫ and ⌦ swept across every offset never expose an asterisk; ⏎ splits it into two bold-italic halves; `inline()` still byte-identical on all 31 earlier cases and every source round-trips. |
| 2026-08-23 | **⏎ inside a link tore it in half and showed the reader its syntax.** `splitMarked()` closed and reopened every *delimiter pair* the cut fell inside, but a link is not a pair — it is `[`, a label, `](`, a url, `)` — so cutting `see [my link](http://x.y) end` left `see [my ` above and `link](http://x.y) end` below, raw syntax visible in both blocks and neither half a link any more. The split is now link-aware: the head closes the link with `](url)` and the tail reopens it with `[`, so both halves stay clickable, which is what Notion does. Cutting at either edge of the label keeps the link whole instead of producing an empty one, and cutting inside `](url)` — a position `snapOut()` already refuses to leave a caret in — moves past the link. Inside a live label the pair machinery is skipped entirely: `scan()` never parses emphasis inside a link, so a `**` written in a label is literal text and closing it would have inserted delimiters the reader never typed. Verified by splitting at *every* offset of five link-bearing lines, in the engine and again in the browser — no bracket or parenthesis ever reaches the reader, the visible text is always preserved exactly, both halves keep their href — plus ⏎ inside and after a bold run unchanged. |
| 2026-08-23 | **`⌦` had the same quarrel with hidden delimiters that `⌫` did.** Chromium takes a `display:none` span away together with the character beside it on *either* side, so `⌦` over the `m` of `==mark==` removed the opening `==` too and left `ark==` showing as literal text. The earlier work fixed `⌫` and never covered `⌦`, which is the rarer key and so went unreported for longer. `AMD.deleteAt()` is `backspaceAt()` forwards: delete the next character the reader can SEE, and drop the pair when that empties the run. It hands the key back to the browser where a block holds nothing invisible, and where nothing but delimiters lies ahead it answers `atEnd` — visually the end of the block — so the existing merge-with-the-next-block rule runs there too, which also settles `⌦` at the visual end of a block doing nothing at all. The merge rule itself is untouched: a sub-page, database, code or differently-typed block is still selected rather than absorbed. Verified by sweeping `⌦` from every offset of five formatted strings — 53 positions, no delimiter ever visible — plus the merge cases either side of it, a plain block keeping the native key, and a code block staying literal. |
| 2026-08-22 | **Three faults behind "weird editor behaviour", all measured rather than guessed.** (1) **Typing after a finished run went inside it.** A `display:none` span holds no caret position, so the offset parked after a run closes does not survive — the browser slides it to the last *visible* spot, inside the run. Tracing every keystroke of `**bold**` showed the caret reported as 7 of 8 the moment the run closed, already between its own closing asterisks: a following space produced `**bold* *` (a literal `*`, an italic run, another `*` — exactly the syntax reported appearing), and typing on produced `**bold more**` with the whole phrase bold. ⏎ split at the same invisible offset, tearing the pair into `**bold***` above `*…**`. Typing now never reads the caret back from the browser: an insertion of *n* characters at *p* puts it at *p + n*, remembered as `_want`, and if the next keystroke lands elsewhere with **only invisible characters between**, the two offsets are the same place on screen and the character is moved back to the intended side. Deliberate moves drop `_want`, so editing inside a bold word still extends it, and a caret navigated to the end of a run keeps typing bold as Word, Docs and Notion do — only the keystroke that *closes* a run leaves you outside. `AMD.snapOut()` does the same for structural operations, so ⏎ never splits a delimiter pair. (2) **A paragraph below a toggle went blank when the toggle collapsed.** `sc-for` keys rows by index, so a row leaving the middle of the list hands its editable element to the next block; `elRef` ignored React's detach, `_els` ended up pointing two ids at one element, and `syncDom` painted it twice with the last write winning. `elRef` now lets go on detach. This was content disappearing from the page while still in the file, and it was found while chasing the reported toggle complaint rather than reported directly. (3) **The gutter's ＋ on a toggle opened the line outside it.** The button sits beside the toggle's title, so the line it opens now appears under that title, inside an open toggle; a closed toggle shows no inside, so there it stays a sibling. Verified: ten source strings typed key by key come back byte-identical with no delimiter ever visible; typing inside a bold word still extends it; ⏎ after and inside a run both split correctly; the paragraph below a collapsing toggle stays on screen; the ＋ line collapses with the toggle; and all seven earlier suites re-run clean. |
| 2026-08-22 | **The delimiter-aware `⌫` was only half a fix, and a block selection dragged the page nowhere.** (1) **Formatting still broke on `⌫`, and the earlier fix is why it was hard to see.** That fix took the key only when the character in front of the caret was itself a hidden delimiter, and handed every "ordinary" character back to the browser as an optimisation. But Chromium deletes a `display:none` span *together with* the character beside it: `⌫` over the `m` of `==mark==` removed the opening `==` as well, leaving `ark==` — and the surviving half showed as literal text, which is exactly the syntax the reporter saw appear. Found by sweeping `⌫` from every caret offset in a formatted block rather than testing the ends: the ends were all correct, and offsets 3, 7, 10 and 13 were the broken ones — every position sitting against a hidden span. So where a block holds anything invisible at all, `⌫` is now ours for every press; a block with no delimiters keeps the native key, which is where the optimisation actually belongs. (2) **The page did not follow a growing block selection.** Nothing is focused in that mode, so there is no caret for the browser to keep on screen and the selection simply ran off the bottom of a still page. The moving end is now scrolled in on every step with `nearest`, the least movement that brings it into view, so a selection growing inside the viewport does not jerk the page around. Verified: the offset sweep is clean at every position of `==mark==` and `see ==mark== here`; 23 `backspaceAt` cases; and in the browser, the selection starts without moving the page, scrolls down as it grows past the bottom and back up as it shrinks past the top, with the moving end on screen throughout. |
| 2026-08-22 | **`⇧`+arrow could not select past the end of a block — and destroyed the selection trying.** The vertical-arrow branch never checked for `⇧`, so holding it while crossing to the next block called `focus()` on that block, which collapses the selection: `⇧↓` from mid-block wiped whatever was selected and dropped the caret below it with nothing selected at all. (Reachable before on the second press; the edge-detection fix earlier the same day made the crossing fire on the first, so it began to bite immediately.) The underlying constraint is not patchable: each block is its own contenteditable element, two of those are two editing hosts, and no browser selection can span them — a selection that needs to leave its block cannot grow, it has to change **kind**. So inside a block the browser keeps it, and at the true end of the text `⇧↑/↓` hands over to the whole-block selection the app already had for the gutter lasso and `⌘A`-twice: `blockSel` already drew the highlight and already backed copy/cut-as-Markdown, delete and replace-on-typing, so the work was wiring rather than building. The handover waits for the end of the *text* rather than the last visual line, so from mid-block the first `⇧↓` still selects the rest of the block and only the next crosses; `_selAnchor`/`_selHead` make `⇧` the other way shrink the range instead of growing it the wrong way, and a pointer press clears both. Blocks that hold no caret (a divider, a table) are included here, unlike in caret motion, since they are real blocks to copy or delete. One trap worth recording: React listens on the root container, so the same keypress went on to reach the window handler that grows an existing selection, and the range jumped two rows on the press that created it — the handover stops propagation. Verified: the first `⇧↓` extends text inside the block, the second selects two whole blocks (highlighted, DOM selection empty, nothing focused), further presses grow and `⇧↑` shrinks; Delete removes exactly the selected blocks, typing replaces them, Escape clears, `⇧↑` at the top of the page does nothing, and a divider is included rather than skipped. |
| 2026-08-22 | **`←/→` could not leave a block, and one caret position could not be left at all.** Each block is its own contenteditable element, and to the browser two of those are two separate documents: caret motion stopped dead at the boundary, so `←` at the very start of a block and `→` at its very end simply did nothing, and the only ways between blocks were the mouse and `↑/↓`. They now step into the neighbour — over anything that holds no caret (a divider, table, sub-page or database), the same skip the vertical keys use. The sharper half of this was found by measuring where the caret actually sits after typing: `**bold**` leaves it *between the two closing asterisks*, inside a `display:none` span with no client rect, and from there the browser cannot move it in either direction — `→` did nothing, for ever, from a position that typing one bold word reaches. So the edge test reads the reader's view rather than the string's: everything between the caret and the end being a hidden delimiter *is* the end, exactly as `⌫` already treats the other edge. Mid-text needed no help — Chromium steps over a whole marker run in a single press, which is why this only ever bit at the edges. `⇧` and held modifiers are untouched, since selection and word jumps belong to the browser. Verified: `←` and `→` cross in both directions, step over a divider, do nothing at the first block, leave mid-text motion and `⇧→` alone, and escape a caret parked between closing delimiters — with the earlier suites re-run clean. |
| 2026-08-22 | **Two editor keys that misbehaved, both measured in a browser before and after.** (1) **`⌘B` with nothing selected wrote `****`.** Wrapping an empty range produces a run with nothing inside it, which is not emphasis and renders as the four literal asterisks the reader then sees — and they stay there if the user clicks away. It now takes the word under the caret, which is what a word processor does and the only reading of "bold this" available with no selection. The word stops at whitespace *and* at any delimiter (read from the same `markMap()` the Backspace rule uses), so `⌘B` inside `**bold**` offers `bold` and the existing toggle strips the pair, instead of swallowing the asterisks into `***bold***`; with no word under the caret — a blank block, or whitespace — the key does nothing at all. (2) **A divider was a wall for `↑/↓`.** The caret could not get past one in either direction, so on a page that opens with a divider everything beyond it was unreachable by keyboard. Three faults, all in the same nine lines: it asked for exactly one neighbour and gave up when that neighbour had no editable element (a divider, table, sub-page or database), so it now steps over them to the next block that can hold a caret; the "is the caret on the last visual line?" test called `getBoundingClientRect()` on a **collapsed** range, which Chromium answers with zeroes, so it was measuring against a rect at the top of the document; and its tolerance was a flat 6px, which is less than the 7px of padding and half-leading under a single line, so it answered no for every caret not already at the end of the text — the first `↓` from mid-line did nothing but park the caret at the end of the line, and it took a second press to leave the block. Both now read `getClientRects()` and scale the tolerance to the caret's own height. The goal column that survives the crossing was already there and is now held honestly: it is dropped on a pointer press, which used to leave a stale column that yanked the next `↓` back to wherever the caret had been travelling before the click. Verified: ⌘B bolds and unbolds the word under the caret, does nothing on a blank block or on whitespace, and a real selection still wraps exactly what was selected; ↓ crosses a divider on the first press, ↑ crosses back, the column set out from is recovered within 6px after passing through a shorter line, and a click resets it. |
| 2026-08-22 | **Two data-loss bugs in the editor, found by auditing the save and block-structure paths and reproduced in a browser before either was touched.** (1) **Typing alone never reached storage.** `readBlock` — the debounced writer behind every keystroke — guarded on `f.block.text === text`, which reads correctly and never once fired: `onInput` writes the model on the way past so the caret never waits on a render, so by the time the guard ran the two were always equal and `persist()` was skipped every time. The text still got saved whenever some *other* edit (⏎, Tab, a menu, a checkbox) wrote the page, which is exactly why this survived so long — nearly every session contains one. Type a sentence, close the tab, and it was gone. The guard now compares against what was last *saved*, tracked per element: the model is not evidence of anything there, since `readBlock` is the code that puts the text into it. (2) **A toggle that stopped being one lost its contents.** Only a toggle has an inside — nothing walks `children` for any other type — so *Turn into → Text*, a markdown shortcut typed in a toggle's title, and ⌫ at its start each took the toggle's children off the page and out of the markdown export while leaving them whole and unreachable in the file. Three doors, one rule, so it went into `repair()` (which every mutation already passes through) rather than into each: a non-toggle carrying `children` has them lifted into the list right after it, and the blank child `repair()` itself guarantees is dropped rather than lifted so an empty toggle leaves no litter. Verified: typed text lands in storage with no other edit and survives a reload, code blocks included; all three doors now keep the child on screen and in the export; and the surrounding behaviour still holds — a live toggle keeps its children, collapse hides them and expand returns them, an empty toggle leaves no stray paragraph, and ⌘Z restores the toggle. The heading-toggle and Backspace suites re-run clean, with no console errors. |
| 2026-08-17 | **Heading toggles, and a ⌫ that can see the hidden markers.** (1) **Toggles came in one size.** A toggle can now title a section at heading 1, 2 or 3, matching the plain heading of that level in type, gutter offset and reader styling, with the arrow scaled to suit. It is a `toggle` with a `level`, not a fourth block type — `repair()`, the three ⏎ exits, Tab-to-nest, `flat()`, drag and the markdown writer all key off `type === 'toggle'` and needed no change; the menus name the levels through the pseudo-types `toggle1`…`toggle3`, unpacked by `blockSpec()` at `setBlockType()`, the one place a type is written (and the one place that *clears* a stale level, or a toggle turned into a paragraph and back would return as a heading). Inside a toggle the markdown hashes now set the toggle's own level instead of converting the block — the old path made a plain heading and left the toggle's children unreachable — and any level swaps to any other, while four or more hashes mean no heading and so do nothing at all. (2) **⌫ at the end of any inline run destroyed its formatting.** §5.1 keeps the markdown source in the DOM with the delimiters hidden, so at the end of `**bold**` the caret sits behind two invisible asterisks: one keystroke ate a delimiter and `bold` came back as a raw `**bold*`. ⌫ now deletes the last *visible* character, and when the run runs out of them it drops the delimiters too, so the text falls back to plain instead of leaving `****`. The mirror case is the same map: when only delimiters separate the caret from column 0, the caret visually *is* at the start, so the block-level ⌫ runs there rather than eating the opening marker. `markMap()`/`backspaceAt()` read the same `scan()` the renderer does — one pass, two consumers — so what counts as a marker can never drift from what is drawn, and source view (where the delimiters are visible) is deliberately left alone. Verified: `inline()` byte-identical to its predecessor across 31 inputs with the source round-tripping; 20 `backspaceAt` cases; and in the browser, all six inline marks deleting down to clean plain text, the three levels swapping in both directions, four hashes inert, collapse/⏎-into-child/markdown-export/source-view/⌘Z all intact, zero console errors. |
| 2026-08-16 | **Demo banner's exit button was a 26px tap target on phones** — below the project's own 44px floor, and it is the *only* way back from a state the banner exists precisely because users would read it as data loss. The message and a 44px button cannot share one 41px row, so on mobile the bar stacks: message on top, full-width 44px button beneath (89px tall). Desktop keeps the single 41px row. Verified at a true 375px width: button 44×351 fully inside the bar, nothing overflowing. |
| 2026-08-16 | **Demo mode is now announced, not silent.** Booting the demo replaces the whole workspace with seeded pages; with nothing on screen saying so, that is indistinguishable from having lost every note. A slim bar at the top of the app now states it and offers "Back to my notes" (`AStore.leaveDemo()`), instead of leaving the exit buried in settings. Added `--warn-bg` / `--warn-fg` / `--warn-bd` in both themes, following the existing `--add-*` / `--del-*` convention rather than overloading another token. Verified in both themes; the banner is absent in normal Firebase mode. |
| 2026-08-16 | **Two editor traps fixed.** (1) **A toggle had no keyboard exit.** ⏎ on its title focused `children[0]`, so a toggle with nothing inside consumed the key and did nothing at all, and once inside ⏎ only ever made more children — no keystroke climbed out. Added three exits: ⏎ on a blank toggle turns it back into a paragraph; ⏎ on a titled toggle opens/creates its first child and puts the caret there; ⏎ on an empty last child climbs out to just after the toggle. "Blank" had to mean *nothing written inside* rather than *no children*, since `repair()` keeps one blank child on every toggle and a length test would have made that exit dead code. `locate()` now returns the containing `parent`, which is what makes climbing out possible. (2) **The slash menu never scrolled to its selection.** The popup is 320px over ~890px of items, and moving the highlight never moved the scroll — so past the sixth item the selection walked out of sight and the arrow keys looked broken. It read worst on the wrap from last back to first, which looked like the selection sticking at the bottom: it *had* returned to the top, 570px above the visible rows. Fixed by adjusting `scrollTop` by the smallest amount that brings the row in (not `scrollIntoView`, which would drag the editor behind it); the first row scrolls fully to top so the section title is not clipped. Also clamped the selection index against the *current* result count — typing narrowed the list under a stale index, leaving nothing highlighted while ⏎ still inserted the clamped last item, so the menu disagreed with itself about what was selected. Verified: all 18 rows stay visible walking down and up, both wraps land correctly, stale index 15 over 1 result highlights row 0 and ⏎ inserts exactly that; all three toggle exits confirmed; zero console errors. |
| 2026-08-16 | **Mobile home screen showed no hierarchy — rebuilt as a tree.** It was one flat `Object.values(pages)` sorted by date, so nesting was invisible (every note at one level) and hidden database-row pages were listed as notes. Now two modes: **browsing** renders the desktop sidebar's shape — indented rows, a 44×44 chevron only where a page has children, 52px row bodies, `N pages inside` on collapsed branches — sharing `state.expanded` with the desktop tree so expansion is consistent across both; **searching** stays flat, since hierarchy would hide matches, and each hit names the page it lives in (`in Meeting notes` / `Top level`). Chevron and row are separate hit targets, so expanding never forces the page open. Verified on a phone viewport: collapsed → 1 root; expand → 3 children at 24px; expand again → grandchild at 42px; leaf rows keep the chevron column so indentation does not lie; an injected hidden row page appeared in neither the tree nor search; tapping a row opens it (20 blocks); the count reports the whole workspace rather than the expanded rows; zero overflow, zero console errors; desktop sidebar untouched. |
| 2026-08-16 | **Full version-system audit — six bugs found and fixed.** (1) **Read-only preview of an unloaded snapshot rendered 0 blocks** — indistinguishable from an empty version, with Restore beside it; `bodyLoading` now covers the read-only case (verified: 5 skeletons, then 6 real blocks). (2) **The safety snapshot's `deepStat` was hardcoded zeros** and omitted `touched`/`gone`, so restore-as-new claimed no nested change for a subtree that had really moved (verified: was `added:0`, now `added:4, touched:2`). Fixed by extracting `buildSnapshot()`, which both `createVersion` and restore now share — the duplication *was* the bug. (3) **The safety stat was computed against a cold baseline**, recording "+8 added" for a page that had not changed since v3; restore now waits for the previous snapshot (verified: now `none:true`). (4) **Version numbers collided after a deletion** — delete v2 of three and the next capture was a second v3; `nextVersionN()` uses `max(n)+1` (verified: 1,3,4 unique). (5) **"Copy this version as Markdown" threw** `(blocks \|\| []).forEach is not a function` — it passed the deep snapshot object `{b,d,p}` where an array was expected; now goes through `vblocks()` and prefetches a cold snapshot. (6) **Deleting a snapshot orphaned its payload** in `vdata`, stored and re-downloaded forever — now dropped via `dropVersionBlocks()`. Also: the history panel no longer prints fabricated counts for legacy snapshots whose payloads are cold, and the nested badge reports pages that *changed* rather than pages that exist. Regression-swept on desktop and mobile: no-change guard, nested-only capture, restore from read-only, diff after restore, 5-page diff scope, mobile chips — zero console errors, zero horizontal overflow. |
| 2026-08-12 | **Two dead interactions found by auditing every `this.X(` call site against the prototype.** Both pre-dated the file split; splitting is what made them findable. (1) **⌘K did nothing.** `openSearch` existed only as a `renderVals` key, so the template binding worked but the two JS call sites — the global keydown handler and the workspace menu's Search item — threw "not a function". Promoted to a real method in `part-tools.js`; the `renderVals` key now delegates to it. (2) **Property visibility toggles threw.** `toggleProp(dbId, propId, scope, viewId)` was called from the Properties panel's eye toggles and from "Hide on the page", but never existed — only the two concrete methods `togglePageProp` and `toggleViewProp` did. Added as the scope dispatcher the call sites already assumed, so a row of toggles stays one binding instead of a branch per call site. Verified: ⌘K and the sidebar button both open search; both scopes hide and restore; 9 eye buttons and the "Hide on the page" item all work; zero errors. |
| 2026-08-12 | **Post-split fix: `lib/helpers.js` declared with `var`, not `const`.** The host re-injects the `<helmet>` block on a hot reload, so the file ran a second time; a top-level `const` redeclaration throws "Identifier already declared" and aborts the *whole* file. It survived only because the first copy was already in scope — one unlucky ordering and every helper would have been missing. `var` re-assigns the same value, so a re-run is harmless. Applies to all 19 top-level names. |
| 2026-08-12 | **Split the 7,524-line `index.dc.html` into an app shell plus ten part files.** The app is still one class on one instance — `lib/parts.js` folds `lib/part-*.js` back onto `Component.prototype`, so nothing about how the code runs changed. Each part is written as an anonymous class (`AlamzaParts.register(class { … })`) purely so the method syntax inside is identical to a class body: code moves between files by straight copy/paste, with no commas to add and nothing to re-indent. The move itself was mechanical — every method was sliced out byte-identical, not retyped. Module-level helpers went to `lib/helpers.js` and `React` is pinned to `window` so parts outside the class scope can reach both. `index.dc.html` keeps the template, the instance fields, the lifecycle and `persist()` — 2,114 lines. Added `ARCHITECTURE.md`: which file owns which area, a grep-able method index, and a task-to-file table. Verified after the split: 172 methods on the prototype, none missing, 388 `renderVals` keys, navigation/versions/menus/icons all live, zero console errors, zero writes. |
| 2026-08-12 | **Snapshots appeared then vanished; no-change captures; mobile diff.** (1) The vanish was `project()` rebuilding every page's `versions` from `remote.vmeta`, which the write paths never updated — so the echo of the snapshot's own write handed the app the previous list and the new version disappeared a moment after appearing. `mirrorNow` and `push` now keep `remote.vmeta` in step, and `onRemote` refuses to adopt a shorter version list than state already holds. (2) `createVersion` now refuses a capture with nothing new — no root change, no nested change, nothing deleted — except the first snapshot on a page; the dialog explains it and drops its Save button, and the pending readout counts the whole subtree so a nested-only edit is not mistaken for "nothing". (3) Mobile diff: the 216px page rail becomes a horizontal chip scroller, the modal goes full-bleed, the title drops and the selects share a row — verified zero horizontal overflow. (4) Deep-snapshot re-audit across leaf pages, delete-then-snapshot, diff spanning a deleted page, restore-revives, and add-then-snapshot: all correct, zero console errors. Auto-messages now distinguish a removed nested page from a changed one. |
| 2026-08-12 | **Version system: found why snapshots vanished, and made versions deep.** Three faults. (1) **`vmeta` was written but never read back.** Version metadata lives in its own node, so on any device without the localStorage mirror every page rendered `versions: []` — history simply gone — and the next save pushed that empty list over the real one, destroying it permanently. `ensureVersionMeta()` now fetches it on page open, `push()` refuses to write an empty version list for a page whose metadata was never confirmed, and a fetched list never overwrites one authored this session. (2) **Snapshots captured against unloaded data.** `createVersion` diffed the new snapshot against a *previous* snapshot that may not have loaded, reporting the whole page as newly added and storing that wrong stat permanently; it also captured whatever bodies happened to be resident. It now prefetches every body, table and the previous snapshot, then re-runs — and holds a lock across the whole author, since two calls in one tick both read the pre-commit list and the second discarded the first. (3) **Versions were page-deep, not tree-deep.** A snapshot now captures the entire subtree — child pages, their children, and every database any of them embeds — as `{b, d, p}` in `vdata`, with a title-only `scope[]` manifest in `vmeta` so the diff can list nested pages without a fetch. The diff viewer gained a page rail with per-page `+/−` counts (first changed page auto-selected), auto-messages name nested edits ("Changes in 2 nested pages"), version rows carry a `+N nested` badge, and restore rewrites the whole subtree in one write — recreating children deleted since the snapshot, leaving newer ones alone. Legacy array-shaped snapshots normalise on read. Also removed a duplicated Data & sync block that an earlier edit had left mislabelled as section 6. |
| 2026-08-11 | **Migration was re-running on every page load.** The "already migrated" test was `!haveOldPages && !haveOldDbs` — it inferred completion from the old nodes being deleted. But that cleanup is best-effort by design (last step, own try/catch, so a failure there cannot lose data), and when it failed the condition never became true: every single load re-migrated the whole workspace, re-reading every page body. Measured before: full re-migration each load; after: 15.2 KB total for 34 pages, migration skipped on one tiny read. Fixed with a durable `layout: 4` stamp at its own top-level path — not under `meta`, which `push()` rewrites wholesale — written *before* cleanup. **Also: "index not received yet" is now a real state.** `ready` only means the SDK booted, so a signed-in user with an empty local mirror was shown "Your workspace is empty" and a New page CTA that would write a stray page into a workspace holding 32 real notes. `AStore.indexReady` distinguishes the two (immediate when a cached index is painting or `idx` is confirmed absent, otherwise on the first `idx` child, 8 s floor), and both empty states now show skeletons until it resolves. The migration spinner also announces at start rather than on the first completed batch — the first batch was exactly the window the user spent looking at a wrongly-empty workspace. |
| 2026-08-11 | **Sub-page invisible in its parent — and the class of bug behind it.** A child page is recorded twice: `parentId` (what the sidebar reads) and a `subpage` block in the parent's body (what the page renders). `movePage` conflated "new parent's body not loaded" with "move to root" — same `else` branch — so it set `parentId` and skipped the block, producing a page visible in the sidebar and absent from its parent. Fixed, and the branch is now explicit so it cannot silently return. Because no creation-side fix repairs pages already in that state, added `reconcileChildren()`, which runs when a body is in hand and appends links for orphaned children — add-only, so removal stays owned by trash/delete. Also: `ensureBody()` now resolves after React has committed, since `needParent()` retries on that promise and was re-running against stale `blocks: null` and refetching; three Firebase-only crash sites where an unloaded table's `.rows` was dereferenced (row modal, HTML clipboard export, Duplicate database) now degrade or fetch instead of throwing; `newPage(null)` no longer writes an `expanded["null"]` key. |
| 2026-08-11 | **Bandwidth: found the amplifier.** ~3 MB of notes was generating 70–200 MB of downloads for two users. Three causes, all now fixed. (1) **Duplicate listeners** — `init()` registered an auth observer and subscribed inside it; the app retried `init()` on a timer while the SDK was still importing, and `onAuthStateChanged` fires again on every hourly token refresh, so each pass attached another full listener set — and `onChildAdded` replays every child to *each* listener. N sets = N full downloads, growing inside a session, nothing ever detached. `init()` is now single-flight, `subscribe()` idempotent per uid, every handle released. (2) **Databases were whole-node and echoed their own writes** — `dbs/<id>` held every row, was subscribed, and had no writer-id guard, so one keystroke in one cell downloaded the entire table back every 2.2 s to both users, and boot pulled every table in full. Split into `dbmeta` (props/views/order) + `dbrow/<dbId>/<rowId>` + a ~60 B `dbrev` ping; rows load on first view, a cell edit broadcasts one row, a reorder writes only the order array. (3) **The search digest rode along on every save** — moved to `dig/<pageId>`, fetched in one read the first time search is used, which in this app is rare; `idx` is now ~110 B. Also: `stats.down` meters every listener callback and explicit read by node kind and is shown in Settings, since the old counter measured only explicit reads and so reported almost nothing while the leak ran. Evaluated and rejected coarse-grained `updatedAt` — it would have saved ~40 B per save at the cost of cross-device freshness, which the digest move already beat. |
| 2026-08-04 | **Index/body split — the boot no longer scales with the corpus.** The previous pass stopped saves from echoing, but startup still downloaded every page body, because a note's title and its text lived in the same node: a 17 MB workspace was a 17 MB cold start. Pages are now `idx/<id>` (~180 B: title, icon, parent, order, flags, 400-char search digest) and `body/<id>` (the blocks, fetched only on open). Sidebar, search, breadcrumbs, mentions, backlinks and the mobile home run off the index alone — ~200 notes boot on ~36 KB, and it stays flat as the workspace grows. Bodies cache under a ~2 MB `localStorage` LRU; `blocks: null` means "not fetched" and is guarded everywhere so a write can never serialise null over real text; an unfetched page shows a skeleton sized from the index. Search matches the digest for unopened notes and full text for loaded ones; exports fetch the corpus explicitly with a progress toast. Migration streams 25 pages per update instead of reading and writing 17 MB at once, and — critically — no longer writes an ancestor and its descendant in the same multi-path update, which Firebase rejects wholesale and which had left the index empty while the real data sat untouched. A failed migration now shows a "your notes are safe" banner with Retry rather than an empty workspace. |
| 2026-08-04 | **Realtime Database rewritten for cost and speed** — same backend, opposite shape. The old layer did `set(workspaces/<uid>, entireWorkspace)` every 240 ms of typing while `onValue` listened on that exact path, so every save echoed the whole workspace back as a billed download; snapshot bodies made it worse, since history is append-only yet was re-sent on every keystroke pause. Roughly 90 MB/hour for one user against a 10 GB month. Now: pages are per-`pageId`, the only subscribed path is a ~30-byte `rev/<pageId>` index, and entries carrying this tab's writer id are ignored — a single-device session downloads nothing after boot. The app paints from a `localStorage` mirror before the network is touched (the old build showed an empty shell and waited), then delta-fetches only pages newer than the mirror. Snapshot bodies moved to `vdata/` as write-once cold data, fetched only when opened/diffed/restored, with `stat` precomputed at snapshot time so the history panel never needs one. Saves are a multi-path `update()` of just the dirty subtrees on a two-tier debounce (240 ms local, 2.2 s network + blur/hide/unload). Existing workspaces migrate themselves on first load in one atomic update that also clears the legacy node. Rules added at `lib/database.rules.json`. |
| 2026-08-04 | **Mobile pass + versions.** Editor margins cut: the phone was paying a desktop's 40px page padding, a 48px title indent and a 46px block gutter whose handles only appear on hover — something a finger cannot do. Padding is 12px, the title indent is gone, the gutter is not rendered at all on touch (long press gives the same actions), and the title is 29px. About 80px of width returned on a 390px screen. New **All notes** home screen on phones: every live note newest-first with icon, snippet and time, searched across title *and* body; it is the first bar tab and where Back lands at the root. **Long press is now the phone's right-click** — it selects the word under the finger and opens the editor menu **alone**; the floating colour bar is suppressed on touch, since the bottom strip already covers bold/italic/code. That menu gained Select all, Select this block and Copy as Markdown. **Clicking a version opens it read-only** instead of jumping to a diff — the row's Diff button does that — and the read-only banner carries Copy as Markdown (titled with the version, not the working copy), Diff, Restore… and Back to current. |
| 2026-08-04 | Code blocks made literal and fast. Four faults, one root: the block was read back with `textContent`, which drops the line structure the browser stores as `<div>`/`<br>` — so a multi-line paste became one line, Enter appeared to do nothing (the break was made, read back as absent, then flattened by the next render), and blank lines vanished. Paste and Enter now insert one exact text node instead of going through `execCommand`, and the DOM is read the way it renders. Colour no longer switches off on focus — that was a deliberate trade to keep the DOM readable as source, and it is no longer needed. Typing cost: the old path ran highlight.js, rebuilt `innerHTML`, restored the caret, ran the markdown-shortcut regex and sliced the whole text for the `/` menu on **every keystroke**; now a keystroke is one DOM read (coalesced per frame) and one gutter write, with tokenising deferred to a size-scaled pause and dropped entirely above 120k characters. Measured on 1200 lines: ~5 ms per keystroke; on 4000 lines: ~2 ms. Line numbers align because code no longer soft-wraps, and the gutter is one text node rather than one element per line, painted only from the model — React never writes it, so it cannot go stale behind an imperative update. |
| 2026-08-04 | Row drag rebuilt on a single measurement. The engine used to hit-test the live DOM with `elementFromPoint` every frame while it was also translating the cards, which is a feedback loop: a card slid out from under the pointer, the pointer landed on its neighbour, the index flipped and the card slid back — sixty times a second. A hovered card also matched its own `:hover` rule, whose `transform: translateY(-2px)` is emitted with `!important` and outranks the inline shift, so gallery and board cards snapped home mid-drag. Now layout is measured once before anything moves and every later decision is arithmetic over that snapshot (scrolling is subtracted, not re-measured); rows are pointer-inert for the duration (`.dbDrag`); and the drop commits the very index the indicator was showing instead of re-resolving against a DOM whose transforms have just been cleared — which is what made a row sometimes land and sometimes spring back. Grid drops now decide before/after on X, matching the vertical seam. Escape cancels a drag. Every database write is FLIP-animated (`patchDb`): rows that move slide, rows that appear fade up, rows that did not move cost nothing. |
| 2026-08-03 | Reorder animation rebuilt on measured slot geometry — cards move to the real position of the slot they will settle into, so a wrapping gallery no longer scrambles; transitions persist across pointer moves so cards tween instead of snapping. Paste keeps its whitespace (`white-space: pre-wrap` on every editable block) and a large paste inserts the first 40 blocks immediately then streams the rest in idle chunks as one undo step. `syncDom` repaints only blocks near the viewport, deferring the rest to idle. |
| 2026-08-03 | Inline-database bleed made measured rather than fixed. A hard `-180px` pushed the block 122px past the viewport; because the page scroller clips horizontally, the far gallery column and board columns became invisible and undroppable. The bleed is now `(scrollerClientWidth − textColumnWidth) / 2 − 12`, floored at 0, so it only ever uses margin that exists and the block's right edge never leaves the scroller's client box. |
| 2026-08-03 | Lasso anchored in document space with edge auto-scroll, so a selection survives scrolling through a long note. Gallery drag shows a vertical insertion rule beside cards instead of a horizontal one. Reordering animates with FLIP — neighbours slide to make room. Requirements pruned: closed audit sections removed, change log condensed to structural turning points. |
| 2026-08-03 | Database drag rebuilt end to end: one combined write for regroup + reorder, a real drag ghost, viewport-clamped edge auto-scroll on both axes, and the block lasso no longer hijacked by presses inside a database. Backlog items 2, 3, 5, 6, 7 shipped (focus mode, word count, headings in search, code line numbers, table cell navigation). |
| 2026-08-03 | Database chrome brought to Notion: editable name and icon, per-view settings with a starred default view, add/duplicate/delete views, "start with properties collapsed", filter and sort menus rebuilt on the option model. Deep duplication and versions now both carry embedded databases. |
| 2026-08-02 | Property system rebuilt to Notion's model (§7.1) — coloured options, 15 types, per-view and per-page visibility, inline option editing. |
| 2026-08-02 | Two audit rounds closed (21 issues, then 5 partial items + 16 bugs). Icons, roles, mobile parity, right-click menus, undo/redo, save indicator, accessibility. |
| 2026-08-02 | Firebase project connected with a demo mode beside Google sign-in; sign-in failures diagnosed rather than swallowed (§9.2). |
| 2026-08-02 | Visual system re-based on Notion's palette and 3–8px radii; typography moved to the native system stack. |
| 2026-08-02 | Initial build from the kickoff brief and Q&A: local-first store that auto-switches to Firebase, full block editor, version control with diffs and restore, inline databases, sharing, settings, purpose-built mobile shell. |
