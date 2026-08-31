/* shared shapes, so a test says what it is testing and nothing else */
function page(id, over) {
  return Object.assign({
    id, parentId: null, title: 'Page ' + id, icon: '', iconType: '', cover: '',
    order: 0, favorite: false, trashed: false, hidden: false,
    createdAt: 1, updatedAt: 1, versions: [],
    share: { published: false, slug: id, password: null, invites: [] },
    blocks: [block('b_' + id, 'hello')]
  }, over || {});
}
function block(id, text, over) {
  return Object.assign({ id, type: 'p', text, indent: 0 }, over || {});
}
function version(id, n, over) {
  return Object.assign({
    id, n, message: 'snapshot ' + n, auto: true, createdAt: 1000 + n,
    author: 'Tester', stat: { added: 0, removed: 0, changed: 0, none: true },
    deepStat: { pages: 1, added: 0, removed: 0, changed: 0, touched: 0, gone: 0 },
    scope: [], title: '', icon: ''
  }, over || {});
}
function db(id, rows, over) {
  return Object.assign({
    id, name: 'Table ' + id, icon: '', props: [{ id: 'pr1', name: 'Name', type: 'text' }],
    views: [{ id: 'v1', kind: 'table', name: 'Table' }], defaultView: 'v1',
    rows: rows || []
  }, over || {});
}
function row(id, name, over) {
  return Object.assign({ id, cells: { pr1: name }, createdAt: 1, updatedAt: 1 }, over || {});
}
module.exports = { page, block, version, db, row };
