/* Section D — the version UI. Small things, but each one is a place where the
   screen and the code disagreed about what would happen. */
const { makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

async function history(n, over) {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'one')] }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b2', 'child one')] })
    },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  for (let i = 0; i < n; i++) {
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'take ' + i)] });
    app.createVersion('message number ' + i);
    await settle();
  }
  if (over) over(app);
  return app;
}

describe('D — the version list', () => {
  it('D2 · a mobile row carries everything the desktop row does', async () => {
    const app = await history(2);
    app.setState({ isMobile: true, sheet: 'versions' });
    const row2 = app.renderVals().versionList[1];
    ['tag', 'when', 'message', 'author', 'auto', 'stat', 'add', 'del', 'chg', 'deep'].forEach(k =>
      assert.ok(k in row2, 'the row is missing ' + k));
    assert.ok(typeof row2.select === 'function', 'a mobile row must open read-only');
    assert.ok(typeof row2.more === 'function', 'and must reach the rest of the actions');
  });

  it('D3 · every row exposes its menu without a right-click', async () => {
    const app = await history(1);
    app.setState({ panel: 'versions' });
    const row1 = app.renderVals().versionList[1];
    row1.more({ preventDefault() {}, stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ right: 300, bottom: 200 }) } });
    assert.eq(app.state.menu && app.state.menu.kind, 'version');
    assert.eq(app.state.menu.id, app.state.pages.p1.versions[0].id);
  });

  it('D11 · selecting the message text does not open the preview', async () => {
    const app = await history(1);
    app.setState({ panel: 'versions' });
    const row1 = app.renderVals().versionList[1];
    app.sandbox.getSelection = () => ({ toString: () => 'message number 0', isCollapsed: false });
    row1.select({ stopPropagation() {} });
    assert.eq(app.state.roVersion, null, 'a drag to select text is not a click to navigate');
    app.sandbox.getSelection = () => ({ toString: () => '', isCollapsed: true });
    row1.select({ stopPropagation() {} });
    assert.ok(app.state.roVersion, 'an ordinary click still opens it');
  });

  it('D12 · opening a version read-only keeps the panel open', async () => {
    const app = await history(2);
    app.setState({ panel: 'versions' });
    app.restore(app.state.pages.p1.versions[0].id, 'ro');
    await settle();
    assert.eq(app.state.panel, 'versions', 'the panel is how you pick the next one');
    assert.eq(app.state.sheet, null);
  });

  it('D13 · the highlight follows what is being previewed', async () => {
    const app = await history(2);
    app.setState({ panel: 'versions' });
    let list = app.renderVals().versionList;
    assert.notOk(list.slice(1).some(v => v.bg !== 'transparent'), 'no version is being previewed yet');
    assert.notOk(list[0].bg === 'transparent', 'so CURRENT is what you are looking at');

    const vid = app.state.pages.p1.versions[0].id;
    app.restore(vid, 'ro');
    await settle();
    list = app.renderVals().versionList;
    assert.eq(list[0].bg, 'transparent', 'CURRENT is no longer what is on screen');
    const shown = list.slice(1).filter(v => v.bg !== 'transparent');
    assert.eq(shown.length, 1);
    assert.eq(shown[0].tag, 'v1');
  });
});

describe('D — the dialogs', () => {
  it('D4 · Save version reports that it is working', async () => {
    const app = await history(1);
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: null, blockCount: 2 });
    app.store.bodies.p2 = [block('b2', 'child one'), block('b3', 'child two')];
    app.setState({ modal: { kind: 'newVersion', msg: '' } });
    app.extraVals().commitVersion();
    assert.ok(app.state.capturing, 'the button must not just go dead while it fetches');
    assert.ok(app.extraVals().verBusy);
    await settle(20);
    assert.notOk(app.state.capturing, 'and must come back');
  });

  it('D5 · the preview of the auto message is the message that gets saved', async () => {
    const app = await history(1);
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'root moved')] });
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b2', 'child moved')] });
    app.setState({ modal: { kind: 'newVersion', msg: '' } });
    const preview = app.extraVals().autoMsgPreview;
    app.createVersion('');
    await settle();
    const saved = app.state.pages.p1.versions.slice(-1)[0].message;
    assert.eq(preview, saved, 'the dialog promised one thing and stored another');
  });

  it('D6 · the dialog says it covers the subtree, not "the page"', async () => {
    const app = await history(1);
    app.setState({ modal: { kind: 'newVersion', msg: '' } });
    const v = app.extraVals();
    assert.includes(v.verScopeLine.toLowerCase(), 'sub-page');
  });

  it('D15 · the message box is focused and Cmd-Enter commits', async () => {
    const app = await history(1);
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'moved on')] });
    app.setState({ modal: { kind: 'newVersion', msg: 'typed' } });
    const v = app.extraVals();
    assert.ok(v.verAutoFocus, 'the one field in the dialog should be ready to type in');
    let prevented = false;
    v.verMsgKey({ key: 'Enter', metaKey: true, preventDefault() { prevented = true; } });
    await settle();
    assert.ok(prevented);
    assert.eq(app.state.pages.p1.versions.slice(-1)[0].message, 'typed');
  });

  it('D15 · Save is disabled rather than disappearing', async () => {
    const app = await history(1);
    app.setState({ modal: { kind: 'newVersion', msg: '' } });
    const v = app.extraVals();
    assert.ok(v.verBlocked, 'nothing has changed since the last snapshot');
    assert.ok(v.showSaveVersion, 'the primary action must stay on screen');
    assert.ok(v.verSaveOff, 'disabled, so the dialog explains itself');
  });
});

describe('D — the diff viewer', () => {
  async function nested() {
    const app = await history(1);
    /* only the CHILD moves */
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b2', 'child two')] });
    const vid = app.state.pages.p1.versions[0].id;
    app.openDiff(vid, 'current');
    await settle();
    return { app, vid };
  }

  it('D7 · the header counts the whole comparison, not one page of it', async () => {
    const { app } = await nested();
    app.setState({ diffPage: 'p1' });          // look at the root, which is unchanged
    const v = app.extraVals();
    assert.eq(v.diffAdd + v.diffDel + v.diffChg, 1, 'the child changed and the header said nothing');
    assert.ok(v.diffPageStat, 'and the selected page gets its own line');
  });

  it('D8 · an unchanged page in a changed comparison says so precisely', async () => {
    const { app } = await nested();
    app.setState({ diffPage: 'p1' });
    const v = app.extraVals();
    assert.ok(v.diffNone);
    assert.includes(v.diffNoneText.toLowerCase(), 'this page');
    assert.notOk(/these two versions are identical/i.test(v.diffNoneText));
  });

  it('D8 · a comparison with nothing in it still says so', async () => {
    const app = await history(1);
    const vid = app.state.pages.p1.versions[0].id;
    app.openDiff(vid, 'current');
    await settle();
    const v = app.extraVals();
    assert.ok(v.diffNone);
    assert.includes(v.diffNoneText.toLowerCase(), 'identical');
  });

  it('D16 · Restore is offered for whichever side is a version', async () => {
    const { app, vid } = await nested();
    app.pickDiffSide('a', 'current');
    app.pickDiffSide('b', vid);
    await settle();
    const v = app.extraVals();
    assert.ok(v.diffCanRestore, 'swapping the selects lost the button entirely');
    assert.includes(v.diffRestoreLabel, 'v1');
    v.diffRestore();
    assert.eq(app.state.modal.vid, vid, 'and it must restore the version, not the working copy');
  });
});

describe('D — the read-only banner', () => {
  it('D10 · Escape leaves the preview', async () => {
    const app = await history(1);
    app.restore(app.state.pages.p1.versions[0].id, 'ro');
    await settle();
    assert.ok(app.state.roVersion);
    assert.ok(app.escapeKey(), 'Escape must be handled');
    assert.eq(app.state.roVersion, null);
  });

  it('D10 · Escape closes a modal before it leaves the preview', async () => {
    const app = await history(1);
    app.restore(app.state.pages.p1.versions[0].id, 'ro');
    await settle();
    app.setState({ modal: { kind: 'diff' } });
    app.escapeKey();
    assert.eq(app.state.modal, null);
    assert.ok(app.state.roVersion, 'one Escape, one thing closed');
    app.escapeKey();
    assert.eq(app.state.roVersion, null);
  });

  it('D14 · a long message cannot break the banner', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.store._vmetaSeen.p1 = true;
    app.createVersion('x'.repeat(400));
    await settle();
    app.restore(app.state.pages.p1.versions[0].id, 'ro');
    await settle();
    const v = app.renderVals();
    assert.ok(v.readOnlyLabel.length < 140, 'the label is ' + v.readOnlyLabel.length + ' characters long');
    assert.ok(v.readOnlyTitle.length > 200, 'the full text stays available on hover');
  });
});

describe('D — leftovers', () => {
  it('D1 · an unread history still renders as loading', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.store.vmetaStore.p1 = [version('v1', 1)];
    app.setState({ panel: 'versions' });
    const v = app.renderVals();
    assert.ok(v.versionsLoading);
    assert.notOk(v.noVersions);
  });

  it('D9 · a restore says what it recreated', async () => {
    const app = await history(1);
    const vid = app.state.pages.p1.versions[0].id;
    delete app.state.pages.p2;
    app.restore(vid, 'replace');
    await settle();
    assert.includes(app.toasts.join(' | '), 'recreated');
  });

  it('D17 · a comment inside a toggle is not reported as no comments', async () => {
    const app = makeApp({
      pages: {
        p1: page('p1', {
          blocks: [block('t', 'Section', {
            type: 'toggle',
            children: [block('c', 'inside', { comments: [{ id: 'c1', author: 'A', text: 'hi', at: 1 }] })]
          })]
        })
      },
      pageId: 'p1'
    });
    const v = app.renderVals();
    assert.eq(v.commentThreads.length, 1, 'the thread is found by walking children');
    assert.notOk(v.noComments, 'so the empty state must not also be shown');
  });
});
