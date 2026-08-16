/* Alamza Notes — demo workspace (used the first time the app runs). */
(function () {
  var B = function (type, text, extra) {
    return Object.assign({ id: 'b' + Math.random().toString(36).slice(2, 9), type: type, text: text || '', indent: 0 }, extra || {});
  };
  var now = Date.now();
  var day = 86400000;

  var db = {
    id: 'db_road',
    name: 'Roadmap',
    props: [
      { id: 'name', name: 'Task', type: 'text' },
      { id: 'status', name: 'Status', type: 'select', options: ['Backlog', 'In progress', 'In review', 'Shipped'] },
      { id: 'tags', name: 'Area', type: 'multiSelect', options: ['Editor', 'Versions', 'Sync', 'Mobile', 'Sharing'] },
      { id: 'owner', name: 'Owner', type: 'person', options: ['Alamza', 'Hira', 'Bilal', 'Zoya'] },
      { id: 'due', name: 'Due', type: 'date' },
      { id: 'effort', name: 'Effort', type: 'number' },
      { id: 'done', name: 'Done', type: 'checkbox' }
    ],
    views: [
      { id: 'v_list', name: 'All tasks', type: 'list', filters: [], sorts: [] },
      { id: 'v_board', name: 'By status', type: 'board', groupBy: 'status', filters: [], sorts: [] },
      { id: 'v_table', name: 'Table', type: 'table', filters: [], sorts: [] },
      { id: 'v_card', name: 'Gallery', type: 'card', filters: [], sorts: [] }
    ],
    rows: [
      { id: 'r1', icon: '🧬', cover: 'linear-gradient(135deg,#5A4FCF,#9F7AEA)', cells: { name: 'Word-level diff inside changed blocks', status: 'In review', tags: ['Versions'], owner: 'Alamza', due: '2026-08-06', effort: 5, done: false } },
      { id: 'r2', icon: '⌨️', cover: 'linear-gradient(135deg,#0EA5A0,#22D3A6)', cells: { name: 'Slash menu keyboard navigation', status: 'Shipped', tags: ['Editor'], owner: 'Hira', due: '2026-07-24', effort: 3, done: true } },
      { id: 'r3', icon: '📱', cover: 'linear-gradient(135deg,#F97316,#FBBF24)', cells: { name: 'Mobile command bar + sheets', status: 'In progress', tags: ['Mobile', 'Editor'], owner: 'Bilal', due: '2026-08-11', effort: 8, done: false } },
      { id: 'r4', icon: '🔐', cover: 'linear-gradient(135deg,#334155,#64748B)', cells: { name: 'Password-protected public links', status: 'Backlog', tags: ['Sharing'], owner: 'Zoya', due: '2026-08-20', effort: 3, done: false } },
      { id: 'r5', icon: '🔥', cover: 'linear-gradient(135deg,#DC2626,#F59E0B)', cells: { name: 'Realtime Database write batching', status: 'In progress', tags: ['Sync'], owner: 'Alamza', due: '2026-08-09', effort: 5, done: false } },
      { id: 'r6', icon: '🗂️', cover: 'linear-gradient(135deg,#2563EB,#38BDF8)', cells: { name: 'Board view drag between groups', status: 'Backlog', tags: ['Editor'], owner: 'Hira', due: '2026-08-25', effort: 8, done: false } }
    ]
  };

  var specV1 = [
    B('h1', 'Versioning'),
    B('p', 'Every page is a living document. We keep the *current* state editable and snapshot it on demand.'),
    B('h2', 'Rules'),
    B('ul', 'The current page is always what opens.', { indent: 0 }),
    B('ul', 'Snapshots are immutable.', { indent: 0 }),
    B('p', 'Open question: how do we name a version when the author writes nothing?')
  ];

  var specV2 = [
    B('h1', 'Versioning'),
    B('p', 'Every page is a living document. We keep the **current** state editable and snapshot it on demand.'),
    B('h2', 'Rules'),
    B('ul', 'The current page is always what opens, and it auto-saves.', { indent: 0 }),
    B('ul', 'Snapshots are immutable.', { indent: 0 }),
    B('ul', 'A snapshot message describes the state being closed.', { indent: 0 }),
    B('h2', 'Naming'),
    B('p', 'If the author leaves the message blank we generate one from the diff.')
  ];

  var specNow = [
    B('h1', 'Versioning'),
    B('callout', 'This page is the reference implementation. Open **Versions** in the header to diff it against v1.', { icon: '🧭' }),
    B('p', 'Every page is a living document. We keep the **current** state editable and snapshot it on demand. The snapshot message always describes the state being *closed*, never the one you are about to write.'),
    B('h2', 'Rules'),
    B('ul', 'The current page is always what opens, and it auto-saves.', { indent: 0 }),
    B('ul', 'Snapshots are immutable — restoring never rewrites history.', { indent: 0 }),
    B('ul', 'A snapshot message describes the state being closed.', { indent: 0 }),
    B('ul', 'Restore offers `replace`, `as new version`, or `read-only`.', { indent: 0 }),
    B('h2', 'Naming'),
    B('p', 'If the author leaves the message blank we generate one from the diff, e.g. ~~"Untitled"~~ ==Added 2 headings, revised 3 blocks==.'),
    B('h2', 'Similarity score'),
    B('p', 'Two blocks are paired for a word-level diff when their type matches and their prefix distance is small:'),
    B('math', 'sim(a,b) = \\frac{2\\,|LCS(a,b)|}{|a| + |b|}'),
    B('h2', 'Snapshot shape'),
    B('code', 'type Version = {\n  id: string\n  n: number\n  message: string   // describes the state being closed\n  auto: boolean     // true when generated from the diff\n  createdAt: number\n  blocks: Block[]\n}', { lang: 'typescript' }),
    B('toggle', 'Why not store diffs instead of snapshots?', {
      collapsed: false,
      children: [
        B('p', 'Snapshots are O(n) in storage but O(1) to restore, and Realtime Database charges on read volume, not size. Restore correctness beats storage cleverness.')
      ]
    }),
    B('divider', ''),
    B('h2', 'Work in flight'),
    B('database', '', { dbId: 'db_road' })
  ];

  var pages = {
    p_home: {
      id: 'p_home', parentId: null, icon: '🛰️', title: 'Alamza HQ', order: 0,
      favorite: true, trashed: false, createdAt: now - 30 * day, updatedAt: now - 2 * day,
      updatedBy: 'Alamza', versions: [],
      share: { published: false, slug: 'alamza-hq', password: null, invites: [] },
      blocks: [
        B('p', 'Everything the team is building, in one tree. Start from the sub-pages below.'),
        B('callout', 'New here? Type `/` on any empty line to insert a block.', { icon: '👋' }),
        B('h2', 'Spaces'),
        B('subpage', '', { pageId: 'p_spec' }),
        B('subpage', '', { pageId: 'p_notes' }),
        B('subpage', '', { pageId: 'p_journal' })
      ]
    },
    p_spec: {
      id: 'p_spec', parentId: 'p_home', icon: '🧪', title: 'Versioning Spec', order: 0,
      favorite: true, trashed: false, createdAt: now - 21 * day, updatedAt: now - 3600000,
      updatedBy: 'Alamza',
      share: { published: true, slug: 'versioning-spec', password: null, invites: [{ email: 'hira@alamza.co', role: 'editor' }, { email: 'bilal@alamza.co', role: 'commenter' }] },
      viewers: [{ name: 'Hira', color: '#0EA5A0' }, { name: 'Bilal', color: '#F97316' }],
      versions: [
        { id: 'ver1', n: 1, message: 'First pass at the versioning rules', auto: false, createdAt: now - 12 * day, author: 'Alamza', title: 'Versioning Spec', icon: '🧪', blocks: specV1 },
        { id: 'ver2', n: 2, message: 'Added the naming section, clarified auto-save', auto: true, createdAt: now - 4 * day, author: 'Alamza', title: 'Versioning Spec', icon: '🧪', blocks: specV2 }
      ],
      blocks: specNow
    },
    p_notes: {
      id: 'p_notes', parentId: 'p_home', icon: '📓', title: 'Meeting notes', order: 1,
      favorite: false, trashed: false, createdAt: now - 18 * day, updatedAt: now - 2 * day,
      updatedBy: 'Hira', versions: [],
      share: { published: false, slug: 'meeting-notes', password: null, invites: [] },
      blocks: [
        B('p', 'One page per meeting. Keep decisions at the top.'),
        B('subpage', '', { pageId: 'p_kick' })
      ]
    },
    p_kick: {
      id: 'p_kick', parentId: 'p_notes', icon: '🎬', title: '28 Jul — Kickoff', order: 0,
      favorite: false, trashed: false, createdAt: now - 5 * day, updatedAt: now - 5 * day,
      updatedBy: 'Hira', versions: [],
      share: { published: false, slug: 'kickoff', password: null, invites: [] },
      blocks: [
        B('h2', 'Decisions'),
        B('todo', 'Snapshots, not deltas', { checked: true }),
        B('todo', 'Mobile gets its own shell', { checked: true }),
        B('todo', 'Publish-to-web ships with password support', { checked: false }),
        B('h2', 'Open'),
        B('quote', 'Do we auto-version on a timer, or only on demand?')
      ]
    },
    p_journal: {
      id: 'p_journal', parentId: 'p_home', icon: '✍️', title: 'Writing journal', order: 2,
      favorite: false, trashed: false, createdAt: now - 9 * day, updatedAt: now - day,
      updatedBy: 'Alamza', versions: [],
      share: { published: false, slug: 'journal', password: null, invites: [] },
      blocks: [
        B('h2', 'Why markdown underneath'),
        B('p', 'The DOM holds the *real* source. Markers are hidden until the caret enters the block, so what you copy is exactly what you wrote — no lossy HTML round-trip.'),
        B('p', 'Press the `</>` button in the header to reveal every marker at once.')
      ]
    },
    p_scratch: {
      id: 'p_scratch', parentId: null, icon: '🗑️', title: 'Old import', order: 9,
      favorite: false, trashed: true, createdAt: now - 40 * day, updatedAt: now - 20 * day,
      updatedBy: 'Alamza', versions: [],
      share: { published: false, slug: 'old-import', password: null, invites: [] },
      blocks: [B('p', 'Superseded by the spec page.')]
    }
  };

  window.ASEED = function () {
    return {
      pages: JSON.parse(JSON.stringify(pages)),
      dbs: { db_road: JSON.parse(JSON.stringify(db)) },
      prefs: { theme: 'light', fullWidth: false, smallText: false, sourceView: false, fontSize: 16 },
      workspace: { name: 'Alamza', icon: '🛰️' }
    };
  };
})();
