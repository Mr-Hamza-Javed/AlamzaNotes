/* Sharing a page with another account, end to end.
   Invitations used to be appended to the SENDER's own workspace, which the
   security rules let nobody else read, so "Invitation sent" went nowhere at
   all and the whole role system was a screen with no wire behind it. */
const { makeApp, settle } = require('./harness');
const { page, block, db, row } = require('./fixtures');

/* Two accounts sharing one server. The store stub enforces the same rule the
   real one does: a shared page is only readable by its owner or a member. */
function twoAccounts() {
  const owner = makeApp({
    pages: { p1: page('p1', { title: 'Team charter', icon: '📌',
                              blocks: [block('b1', 'the charter')] }) },
    pageId: 'p1', user: { uid: 'u1', name: 'Hamza', email: 'hamza@example.com' }
  });
  const guest = makeApp({ pages: {}, pageId: null,
    user: { uid: 'u2', name: 'Ali', email: 'Ali.Khan@Example.com' } });
  /* one shared backend */
  guest.store.inboxes = owner.store.inboxes;
  guest.store.sharedDocs = owner.store.sharedDocs;
  guest.store.published = owner.store.published;
  return { owner, guest };
}
const share = (app, email) => app.setState(s => ({
  pages: { ...s.pages, p1: { ...s.pages.p1, share: Object.assign({}, s.pages.p1.share,
    { invites: (s.pages.p1.share.invites || []).concat([{ email, role: 'viewer' }]) }) } }
}));

describe('E — sharing a page with someone', () => {
  it('the invitation reaches the other account', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    const box = await guest.refreshInbox();
    assert.eq(box.length, 1, 'the invitation never left the sender');
    assert.eq(box[0].pageId, 'p1');
    assert.eq(box[0].fromName, 'Hamza');
    assert.includes(owner.toasts.join(' | '), 'Invitation sent');
  });

  it('the address is matched however it was typed', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ALI.KHAN@Example.COM');
    owner.sendInvite('p1', 'ALI.KHAN@Example.COM', 'viewer');
    await settle();
    assert.eq((await guest.refreshInbox()).length, 1, 'a capitalised address must reach the same inbox');
  });

  it('accepting puts the page in the guest’s sidebar, and it is really readable', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);

    const pg = guest.state.pages.p1;
    assert.ok(pg, 'the page must be in the guest’s workspace');
    assert.eq(pg.blocks[0].text, 'the charter', 'and it must carry the real content');
    assert.eq(pg.shared, true);
    assert.eq(pg.ownerName, 'Hamza');
    assert.deep(guest.renderVals().sharedList.map(x => x.id), ['p1']);
    assert.ok(guest.renderVals().hasShared);
  });

  it('the guest may read it and nothing more', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);
    guest.setState({ pageId: 'p1' });

    assert.eq(guest.myRole(), 'viewer');
    assert.notOk(guest.canEdit());
    assert.ok(guest.isReadOnly());
    guest.mutate(bs => { bs[0].text = 'typed by the guest'; });
    assert.eq(guest.state.pages.p1.blocks[0].text, 'the charter', 'a viewer wrote to a page they only read');
    assert.notOk(guest.canWriteHistory());
  });

  it('someone who was never invited cannot read it', async () => {
    const { owner } = twoAccounts();
    const stranger = makeApp({ pages: {}, pageId: null,
      user: { uid: 'u3', name: 'Nobody', email: 'nobody@example.com' } });
    stranger.store.sharedDocs = owner.store.sharedDocs;
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    stranger.setState({ shares: [{ pageId: 'p1', owner: 'u1', title: 'Team charter' }] });
    await stranger.openShared('p1');
    await settle();
    assert.notOk(stranger.state.pages.p1, 'the page was handed to an account that was never invited');
    assert.deep(stranger.state.shares, [], 'and the dead entry is cleared from their sidebar');
  });

  it('editing the page updates what the guest sees', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);

    owner.mutate(bs => { bs[0].text = 'the charter, revised'; });
    await settle();
    await owner.flushShareSync();          // the fuse, spent without waiting it out
    await settle();
    delete guest._sharedP;
    await guest.openShared('p1');
    await settle(10);
    assert.eq(guest.state.pages.p1.blocks[0].text, 'the charter, revised',
      'the guest was left reading yesterday’s note');
  });

  it('removing someone takes their access with it', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);

    owner.setState(s => ({ pages: { ...s.pages, p1: { ...s.pages.p1,
      share: Object.assign({}, s.pages.p1.share, { invites: [] }) } } }));
    owner.revokeInvite('p1', 'ali.khan@example.com');
    await settle(20);

    delete guest._sharedP;
    await guest.openShared('p1');
    await settle(10);
    assert.notOk(guest.state.pages.p1, 'the page is still readable after access was removed');
  });

  it('a guest’s copy is never written back into their own workspace', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);
    /* the shape push() and the local mirror both key off */
    assert.eq(guest.state.pages.p1.shared, true,
      'without this flag the guest’s app would save someone else’s note as its own');
  });

  it('the demo workspace says so instead of pretending', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' }, { cloud: false });
    app.sendInvite('p1', 'someone@example.com', 'viewer');
    await settle();
    assert.includes(app.toasts.join(' | '), 'Sign in to share');
  });

  it('a malformed address is refused, not silently dropped', async () => {
    const { owner } = twoAccounts();
    owner.sendInvite('p1', 'not-an-email', 'viewer');
    await settle();
    assert.includes(owner.toasts.join(' | '), 'does not look like an email');
    assert.eq(Object.keys(owner.store.inboxes).length, 0);
  });

  it('inviting yourself is refused', async () => {
    const { owner } = twoAccounts();
    owner.sendInvite('p1', 'Hamza@example.com', 'viewer');
    await settle();
    assert.includes(owner.toasts.join(' | '), 'your own account');
  });

  it('only the role that works is offered', () => {
    const { owner } = twoAccounts();
    assert.deep(owner.shareRoles().map(r => r.id), ['viewer'],
      'a role that cannot write back must not be on the menu');
  });

  it('leaving a shared page removes it from this sidebar only', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);
    guest.leaveShared('p1');
    await settle();
    assert.notOk(guest.state.pages.p1);
    assert.deep(guest.state.shares, []);
    assert.ok(owner.store.sharedDocs.p1, 'the owner’s page is untouched');
  });
});

describe('E — the invitations badge', () => {
  it('an invitation you SENT does not light up your own inbox', async () => {
    const { owner } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await owner.refreshInbox();
    const v = owner.extraVals();
    assert.eq(v.inboxCount, 0);
    assert.notOk(v.hasInbox, 'a badge with nothing behind it');
    assert.ok(v.inboxEmpty, 'and the box itself must agree it is empty');
  });

  it('the badge and the list always agree', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    const v = guest.extraVals();
    assert.eq(v.inboxCount, v.inbox.length);
    assert.eq(v.inboxCount, 1);
    assert.notOk(v.inboxEmpty);
  });

  it('an unread inbox says it is checking, not that it is empty', () => {
    const { guest } = twoAccounts();
    const v = guest.extraVals();
    assert.ok(v.inboxLoading);
    assert.notOk(v.inboxEmpty, '"Nothing waiting for you" over an inbox nobody has read yet');
  });

  it('someone else’s page is not this account’s to trash', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);
    guest.setState({ pageId: 'p1', menu: { kind: 'page' } });
    const labels = guest.extraVals().menuItems.filter(i => i.isItem).map(i => i.label);
    assert.notOk(labels.includes('Move to trash'), 'got: ' + labels.join(', '));
    assert.ok(labels.includes('Remove from my sidebar'));
    const off = guest.extraVals().menuItems.filter(i => i.isItem && i.off).map(i => i.label);
    assert.ok(off.includes('Share') && off.includes('Version history'),
      'sharing on and snapshotting someone else’s page are not this account’s to do: ' + off.join(', '));
  });

  it('a guest’s copy never reaches this account’s own storage', async () => {
    const { owner, guest } = twoAccounts();
    share(owner, 'ali.khan@example.com');
    owner.sendInvite('p1', 'ali.khan@example.com', 'viewer');
    await settle();
    await guest.refreshInbox();
    guest.answerInvite(guest.state.inbox[0].id, true);
    await settle(20);
    guest.setState({ pageId: 'p1' });
    const bodies = [];
    guest.store.putBody = (id, b) => bodies.push(id);
    guest.persist();
    assert.deep(bodies, [], 'the guest cached someone else’s note as their own');
  });

  it('the demo workspace does not try to fetch shared pages', async () => {
    const app = makeApp({ pages: {}, pageId: null, shares: [{ pageId: 'p9' }] }, { cloud: false });
    await app.openShared('p9');
    await settle();
    assert.deep(app.state.shares, [{ pageId: 'p9' }], 'a local workspace has no server to ask');
  });
});
