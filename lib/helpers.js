/* Alamza Notes — shared helpers (ids, language list, escaping, text utils).
 *
 * Moved verbatim out of index.dc.html so that lib/part-*.js can see them.
 * A classic script, so every name here is reachable from any other script.
 *
 * Declared with `var`, not `const`: the host re-injects the <helmet> block on
 * a hot reload, and a second run of a top-level `const` throws
 * "Identifier already declared" and aborts the whole file. `var` just
 * re-assigns the same value, so re-running is harmless.
 */
var uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 9);
var LANGS = [
  { id: 'plaintext', name: 'Plain text' }, { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' }, { id: 'python', name: 'Python' },
  { id: 'json', name: 'JSON' }, { id: 'bash', name: 'Bash' }, { id: 'css', name: 'CSS' },
  { id: 'xml', name: 'HTML' }, { id: 'sql', name: 'SQL' }, { id: 'markdown', name: 'Markdown' }
];
var VIEW_GLYPH = { list: '☰', card: '▢', table: '▦', board: '⫴' };
var GUTTER = {
  p: '3px', ul: '3px', ol: '3px', todo: '3px', toggle: '3px',
  h1: '37px', h2: '27px', h3: '20px', quote: '6px', callout: '20px',
  code: '12px', math: '14px', divider: '1px', subpage: '10px', database: '22px'
};

/* ---- heading toggles ----------------------------------------------------
   A toggle heading is a `toggle` carrying a `level`, not a fourth block type.
   That one decision is what keeps it cheap: repair(), the three ⏎ exits,
   Tab-to-nest, flat(), drag, the markdown writer and every `type === 'toggle'`
   test in the app go on working untouched, and the level is a number the
   template reads. The menus need names for the three levels, so they use
   pseudo-types that blockSpec() unpacks at the one place a block is written. */
var TOGGLE_LEVELS = { toggle1: 1, toggle2: 2, toggle3: 3 };
function blockSpec(type) {
  var lvl = TOGGLE_LEVELS[type];
  return lvl ? { type: 'toggle', level: lvl } : { type: type, level: 0 };
}
/* Write a block's type and level together. Anything that is not a heading
   toggle must LOSE the level, or a toggle turned into a paragraph and back
   would silently come back as a heading. */
function setBlockType(block, type, level) {
  block.type = type;
  if (type === 'toggle' && level) block.level = level; else delete block.level;
}
/* the toggle title's typography, per level — h1/h2/h3 here are the same
   numbers the plain headings use in the template, so a toggle heading and a
   heading sit on the same line and share the same gutter offset */
var TOGGLE_STYLE = {
  0: { size: '16px', weight: '400', line: '1.5', space: 'normal', minH: '26px', top: '0px', scale: '1', ph: 'Toggle', mk: '' },
  1: { size: '30px', weight: '600', line: '1.3', space: '-.012em', minH: '40px', top: '26px', scale: '1.4', ph: 'Toggle heading 1', mk: '#' },
  2: { size: '24px', weight: '600', line: '1.3', space: '-.008em', minH: '34px', top: '20px', scale: '1.25', ph: 'Toggle heading 2', mk: '##' },
  3: { size: '20px', weight: '600', line: '1.3', space: 'normal', minH: '28px', top: '16px', scale: '1.12', ph: 'Toggle heading 3', mk: '###' }
};
function toggleStyle(b) { return TOGGLE_STYLE[(b && b.type === 'toggle' && b.level) || 0]; }
var CATALOG = [
  { type: 'p', name: 'Text', glyph: '¶', desc: 'Plain paragraph' },
  { type: 'h1', name: 'Heading 1', glyph: 'H₁', desc: 'Large section title' },
  { type: 'h2', name: 'Heading 2', glyph: 'H₂', desc: 'Medium section title' },
  { type: 'h3', name: 'Heading 3', glyph: 'H₃', desc: 'Small section title' },
  { type: 'ul', name: 'Bulleted list', glyph: '•', desc: 'Simple bullet' },
  { type: 'ol', name: 'Numbered list', glyph: '1.', desc: 'Ordered steps' },
  { type: 'todo', name: 'To-do', glyph: '☑', desc: 'Checkbox item' },
  { type: 'toggle', name: 'Toggle', glyph: '▸', desc: 'Collapsible section' },
  { type: 'toggle1', name: 'Toggle heading 1', glyph: '▸H₁', desc: 'Collapsible large section' },
  { type: 'toggle2', name: 'Toggle heading 2', glyph: '▸H₂', desc: 'Collapsible medium section' },
  { type: 'toggle3', name: 'Toggle heading 3', glyph: '▸H₃', desc: 'Collapsible small section' },
  { type: 'quote', name: 'Quote', glyph: '❝', desc: 'Set text apart' },
  { type: 'callout', name: 'Callout', glyph: '💡', desc: 'Highlighted note' },
  { type: 'divider', name: 'Divider', glyph: '—', desc: 'Horizontal rule' },
  { type: 'code', name: 'Code', glyph: '{ }', desc: 'Syntax-highlighted block' },
  { type: 'math', name: 'Equation', glyph: '∑', desc: 'LaTeX, rendered' },
  { type: 'table', name: 'Table', glyph: '▦', desc: 'Simple rows and columns' },
  { type: 'columns', name: '2 columns', glyph: '◫', desc: 'Side-by-side layout' },
  { type: 'columns3', name: '3 columns', glyph: '⫼', desc: 'Three-column layout' },
  { type: 'subpage', name: 'Sub-page', glyph: '📄', desc: 'A page inside this page' },
  { type: 'database', name: 'Database', glyph: '🗃️', desc: 'List, board, table, gallery' }
];
/* the drawn default page icon, as a string for innerHTML contexts */
var PAGE_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="color:var(--faint);vertical-align:-3px">' +
  '<path d="M4.5 2.75h6.19c.33 0 .65.13.88.37l3.06 3.06c.24.23.37.55.37.88v10.19c0 .69-.56 1.25-1.25 1.25h-9.25c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path>' +
  '<path d="M10.75 3v3.25c0 .41.34.75.75.75h3.25" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path>' +
  '<path d="M6.9 10.5h6.2M6.9 13.4h4.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path></svg>';
function hashStr(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return h; }

/* Notion's ten option colours, light + dark pairs. */
var PROP_COLOR_MAP = {
  default: { bg: 'rgba(55,53,47,.08)', fg: '#37352F', dbg: 'rgba(255,255,255,.09)', dfg: '#D4D4D4', sw: '#D3D1CB' },
  gray: { bg: '#E3E2E0', fg: '#32302C', dbg: '#454B4E', dfg: '#D5D5D4', sw: '#B1AFAB' },
  brown: { bg: '#EEE0DA', fg: '#442A1E', dbg: '#5C3B23', dfg: '#E5C8B4', sw: '#C4A28C' },
  orange: { bg: '#FADEC9', fg: '#49290E', dbg: '#5C3B23', dfg: '#F6C58A', sw: '#E9A25C' },
  yellow: { bg: '#FDECC8', fg: '#402C1B', dbg: '#56452F', dfg: '#F5D97D', sw: '#E7C34A' },
  green: { bg: '#DBEDDB', fg: '#1C3829', dbg: '#243D30', dfg: '#8FCFA4', sw: '#6FB283' },
  blue: { bg: '#D3E5EF', fg: '#183347', dbg: '#143A4E', dfg: '#8FC3E0', sw: '#63A8CE' },
  purple: { bg: '#E8DEEE', fg: '#412454', dbg: '#3C2D49', dfg: '#C1A2D6', sw: '#A484C0' },
  pink: { bg: '#F5E0E9', fg: '#4C2337', dbg: '#4E2C3C', dfg: '#DFA3BE', sw: '#CE7FA3' },
  red: { bg: '#FFE2DD', fg: '#5D1715', dbg: '#522E2A', dfg: '#EFA49C', sw: '#DC7B72' }
};
var PROP_COLORS = Object.keys(PROP_COLOR_MAP).map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));

var PROP_TYPES = [
  { id: 'text', name: 'Text', glyph: 'Aa', group: 'Basic' },
  { id: 'number', name: 'Number', glyph: '#', group: 'Basic' },
  { id: 'select', name: 'Select', glyph: '⌄', group: 'Basic' },
  { id: 'multiSelect', name: 'Multi-select', glyph: '≔', group: 'Basic' },
  { id: 'status', name: 'Status', glyph: '◑', group: 'Basic' },
  { id: 'date', name: 'Date', glyph: '📅', group: 'Basic' },
  { id: 'person', name: 'Person', glyph: '👤', group: 'Basic' },
  { id: 'checkbox', name: 'Checkbox', glyph: '☑', group: 'Basic' },
  { id: 'url', name: 'URL', glyph: '🔗', group: 'Basic' },
  { id: 'email', name: 'Email', glyph: '✉', group: 'Basic' },
  { id: 'phone', name: 'Phone', glyph: '☎', group: 'Basic' },
  { id: 'createdTime', name: 'Created time', glyph: '🕐', group: 'Automatic' },
  { id: 'createdBy', name: 'Created by', glyph: '👤', group: 'Automatic' },
  { id: 'editedTime', name: 'Last edited time', glyph: '🕘', group: 'Automatic' },
  { id: 'editedBy', name: 'Last edited by', glyph: '👥', group: 'Automatic' }
];
/* Types whose value is one of a named, coloured, reorderable list.
   `person` belongs here and was left out, which made it the one property type
   the reader could create but never fill in: the editor only offers an option
   list for OPTION_TYPES, so a Person property had no way to gain a name, while
   the row page still rendered it as a picker — an empty one, with nothing to
   pick and no way to add anything. The demo's Owner column worked only because
   the seed ships its options inline. */
var OPTION_TYPES = { select: 1, multiSelect: 1, status: 1, person: 1 };
/* the ones that hold several values at once */
var MULTI_TYPES = { multiSelect: 1 };
var AUTO_TYPES = { createdTime: 1, createdBy: 1, editedTime: 1, editedBy: 1 };
/* A table with no views renders nothing and throws on `views[0].id`; Firebase
   drops empty arrays on write, so that state is reachable. This is what a
   table falls back to rather than taking the page down. */
function DEFAULT_VIEW() {
  return { id: uid('v'), name: 'All', type: 'list', filters: [], sorts: [], hidden: [] };
}

var BLOCK_LABEL = {
  p: 'Paragraph', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'List item',
  ol: 'Numbered item', todo: 'To-do', quote: 'Quote', callout: 'Callout', divider: 'Divider',
  code: 'Code block', math: 'Equation', toggle: 'Toggle', subpage: 'Sub-page',
  database: 'Database', table: 'Table', columns: 'Columns'
};
/* what a screen reader is told this block is */
function blockLabel(b) {
  if (b && b.type === 'toggle' && b.level) return 'Toggle heading ' + b.level;
  return (b && BLOCK_LABEL[b.type]) || 'Block';
}
var COLOR_HEX = {
  gray: '#8B8D98', brown: '#8A6A50', orange: '#C2762B', yellow: '#B99320',
  green: '#3F8F5F', blue: '#2F6FCF', purple: '#7B5CD6', pink: '#C0568F', red: '#C4433A'
};
var COLOR_BG = {
  gray: 'rgba(139,141,152,.14)', brown: 'rgba(138,106,80,.14)', orange: 'rgba(194,118,43,.14)',
  yellow: 'rgba(185,147,32,.16)', green: 'rgba(63,143,95,.14)', blue: 'rgba(47,111,207,.13)',
  purple: 'rgba(123,92,214,.14)', pink: 'rgba(192,86,143,.13)', red: 'rgba(196,67,58,.12)'
};
var COLORS = [
  { id: '', name: 'Default', sw: 'var(--text)' },
  { id: 'gray', name: 'Gray', sw: '#8B8D98' }, { id: 'brown', name: 'Brown', sw: '#8A6A50' },
  { id: 'orange', name: 'Orange', sw: '#C2762B' }, { id: 'yellow', name: 'Yellow', sw: '#C8A32B' },
  { id: 'green', name: 'Green', sw: '#3F8F5F' }, { id: 'blue', name: 'Blue', sw: '#2F6FCF' },
  { id: 'purple', name: 'Purple', sw: '#7B5CD6' }, { id: 'pink', name: 'Pink', sw: '#C0568F' },
  { id: 'red', name: 'Red', sw: '#C4433A' }
];
var EMOJI = ('📄 page,📝 note,🗒️ memo,📓 notebook,📔 journal,📕 book,📗 book,📘 book,📙 book,📚 books,🔖 bookmark,' +
  '🧾 receipt,📊 chart,📈 growth,📉 decline,🗂️ folder,📁 folder,🗃️ database,🗄️ archive,📅 calendar,🗓️ calendar,' +
  '⏰ alarm,⏳ hourglass,🕰️ clock,🎯 target goal,🚀 rocket launch,🛰️ satellite,🧭 compass,🗺️ map,🧩 puzzle,🧠 brain,' +
  '💡 idea,🔥 fire hot,⚡ bolt,✨ sparkles,🌟 star,⭐ star,🏆 trophy,🥇 medal,🎉 party,🎨 art,🖌️ brush,🖊️ pen,✏️ pencil,' +
  '✍️ writing,📐 ruler,🔧 wrench,🔨 hammer,⚙️ gear settings,🧪 lab test,🔬 microscope,🔭 telescope,🧮 abacus,💻 laptop,' +
  '🖥️ desktop,⌨️ keyboard,🖱️ mouse,📱 phone mobile,🔋 battery,🔌 plug,💾 save,💿 disc,🔐 lock secure,🔑 key,🛡️ shield,' +
  '🚦 signal,🚧 construction,🧱 brick,🏗️ crane,🏠 home,🏢 office,🏦 bank,🌍 earth,🌐 globe web,🛸 ufo,🌙 moon,☀️ sun,' +
  '⛅ cloud,🌊 wave,🌱 seedling,🌳 tree,🍀 clover,🌸 blossom,🍎 apple,☕ coffee,🍵 tea,🧊 ice,🎵 music,🎬 film,📷 camera,' +
  '🎙️ mic,📻 radio,🔔 bell,📌 pin,📎 clip,✂️ scissors,🗑️ trash,♻️ recycle,✅ check done,☑️ checkbox,❌ cross,⚠️ warning,' +
  '❓ question,❗ exclaim,➕ plus,🔁 repeat,🔀 shuffle,🏁 finish,🎲 dice,🃏 card,👋 hello wave,👀 eyes,🤝 handshake,' +
  '🙌 hands,💬 comment,💭 thought,❤️ heart,🫶 love').split(',').map(s => {
    const i = s.indexOf(' ');
    return { ch: s.slice(0, i), name: s.slice(i + 1) };
  });
var SHORTCUTS = [
  { s: 'Navigate', name: 'Open search', keys: '⌘ K' },
  { s: 'Navigate', name: 'Close any overlay', keys: 'Esc' },
  { s: 'Write', name: 'Insert block menu', keys: '/' },
  { s: 'Write', name: 'Link to another page', keys: '@' },
  { s: 'Write', name: 'New block', keys: 'Enter' },
  { s: 'Write', name: 'Soft line break', keys: '⇧ Enter' },
  { s: 'Write', name: 'Indent / outdent', keys: 'Tab · ⇧ Tab' },
  { s: 'Write', name: 'Turn block into text', keys: '⌫ at start' },
  { s: 'Format', name: 'Bold', keys: '⌘ B' },
  { s: 'Format', name: 'Italic', keys: '⌘ I' },
  { s: 'Format', name: 'Inline code', keys: '⌘ E' },
  { s: 'Format', name: 'Strikethrough', keys: '⌘ U' },
  { s: 'Format', name: 'Highlight', keys: '⌘ H' },
  { s: 'Blocks', name: 'Duplicate block', keys: '⌘ D' },
  { s: 'Blocks', name: 'Move block up / down', keys: '⌘ ⇧ ↑ ↓' },
  { s: 'Blocks', name: 'Delete block', keys: '⌘ ⇧ ⌫' },
  { s: 'Blocks', name: 'Select all blocks', keys: '⌘ A twice' },
  { s: 'Blocks', name: 'Copy / cut selected blocks', keys: '⌘ C · ⌘ X' },
  { s: 'History', name: 'Undo', keys: '⌘ Z' },
  { s: 'History', name: 'Redo', keys: '⌘ ⇧ Z' },
  { s: 'Markdown', name: 'Headings', keys: '# · ## · ###' },
  { s: 'Markdown', name: 'Lists', keys: '- · 1. · []' },
  { s: 'Markdown', name: 'Quote / code / rule', keys: '> · ``` · ---' },
  { s: 'Markdown', name: 'Equation', keys: '$$' }
];

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function relTime(t) {
  if (!t) return '';
  const d = Date.now() - t, m = 60000, h = 3600000, dd = 86400000;
  if (d < m) return 'just now';
  if (d < h) return Math.floor(d / m) + 'm ago';
  if (d < dd) return Math.floor(d / h) + 'h ago';
  if (d < 7 * dd) return Math.floor(d / dd) + 'd ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* caret helpers ---------------------------------------------------------- */
function caretOffset(el) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !el.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.selectNodeContents(el); r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
  return r.toString().length;
}
function setCaret(el, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = w.nextNode())) {
    const len = n.nodeValue.length;
    if (acc + len >= off) {
      const r = document.createRange();
      r.setStart(n, Math.max(0, Math.min(len, off - acc))); r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
    acc += len;
  }
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  return false;
}

/* multi-line contenteditable helpers -------------------------------------
   `textContent` is the wrong way to read any element that can hold line
   breaks. The browser materialises lines as <div> and <br>, and textContent
   concatenates them with nothing in between: <div>a</div><div>b</div> reads
   back as "ab". That single fact is why a pasted file collapsed onto one line
   and why pressing Enter looked like it did nothing — the break was made, then
   read back as if it never existed, and the next render flattened it.
   domText reads the DOM the way it is *rendered*. */
var BLOCKY = { DIV: 1, P: 1, LI: 1, PRE: 1, TR: 1, SECTION: 1, ARTICLE: 1, BLOCKQUOTE: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
function domText(root) {
  const first = root.firstChild;
  if (!first) return '';
  /* the shape our own renderer produces: one flat run — no walk needed */
  if (!first.nextSibling && first.nodeType === 3) return first.nodeValue;
  const out = [];
  let open = false;
  const walk = (node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.nodeValue) { out.push(n.nodeValue); open = true; } continue; }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'BR') {
        /* a <br> that closes its parent is the filler that makes an empty
           line visible, not a break of its own */
        if (n.nextSibling) { out.push('\n'); open = false; }
        continue;
      }
      const block = BLOCKY[n.tagName] === 1;
      if (block && open) { out.push('\n'); open = false; }
      walk(n);
      if (block && n.nextSibling) { out.push('\n'); open = false; }
    }
  };
  walk(root);
  return out.join('');
}

/* Insert at the caret without execCommand, which rewrites newlines into <div>
   soup and re-lays-out the whole element. One text node, one range update — a
   megabyte pastes as fast as a single character. */
function insertRaw(el, str) {
  const s = window.getSelection();
  let r;
  if (s && s.rangeCount && el.contains(s.anchorNode)) r = s.getRangeAt(0);
  else { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
  r.deleteContents();
  const t = document.createTextNode(str);
  r.insertNode(t);
  r.setStartAfter(t); r.collapse(true);
  if (s) { s.removeAllRanges(); s.addRange(r); }
}

/* `white-space: pre` does not render a trailing empty line, so a newline typed
   at the very end would look like nothing happened. One filler <br> — which
   domText knows to ignore — gives that line its height. */
function codeFiller(el, text) {
  const last = el.lastChild;
  const isBr = !!(last && last.nodeType === 1 && last.tagName === 'BR');
  const want = text.charCodeAt(text.length - 1) === 10;
  if (want && !isBr) el.appendChild(document.createElement('br'));
  else if (!want && isBr) el.removeChild(last);
}

/* The gutter depends only on how MANY lines there are, so one memo cell
   serves every keystroke that does not change the count. */
var _lnN = -1, _lnS = '';
function lineNoStr(text) {
  let n = 1;
  for (let i = 0, L = text.length; i < L; i++) if (text.charCodeAt(i) === 10) n++;
  if (n === _lnN) return _lnS;
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = i + 1;
  _lnN = n; _lnS = a.join('\n');
  return _lnS;
}
