const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule, readRepositoryFile } = require('./test-support.cjs');

const profileSnapshot = (data) => ({ exists: () => data !== undefined, data: () => data });

function createFixture(documents = {}) {
  const events = [];
  const updates = [];
  const subscriptions = [];
  let pendingRead;
  const api = {
    collection: (_db, ...parts) => ({ path: parts.join('/') }),
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async (reference) => {
      events.push(`get:${reference.path}`);
      if (pendingRead) await pendingRead;
      return profileSnapshot(documents[reference.path]);
    },
    updateDoc: async (reference, changes) => {
      events.push(`update:${reference.path}`);
      updates.push({ reference, changes });
    },
    onSnapshot: (source, onData, onError) => {
      const subscription = { source, onData, onError, stopped: false };
      subscriptions.push(subscription);
      return () => { subscription.stopped = true; };
    }
  };
  return {
    api, events, updates, subscriptions,
    holdRead() {
      let release;
      pendingRead = new Promise((resolve) => { release = resolve; });
      return release;
    }
  };
}

const access = (state) => ({
  getCurrentUid: () => state.uid,
  getManagerProfile: () => state.profile,
  requirePermission: () => state.profile?.active === true && ['owner', 'admin'].includes(state.profile.role)
});

test('authorized-user subscription uses /users, maps and sorts profiles, forwards errors and unsubscribe', async () => {
  const { createProfileService } = await importNativeModule('js/services/profile-service.mjs');
  const fixture = createFixture();
  const received = [];
  const errors = [];
  const stop = createProfileService({ db: {}, api: fixture.api }).subscribeAuthorizedUsers(
    (profiles) => received.push(profiles),
    (error) => errors.push(error)
  );

  assert.equal(fixture.subscriptions[0].source.path, 'users');
  fixture.subscriptions[0].onData({ docs: [
    { id: 'z', data: () => ({ email: 'z@example.test', role: 'viewer', active: true }) },
    { id: 'a', data: () => ({ displayName: 'Alpha', role: 'admin', active: true }) }
  ] });
  assert.deepEqual(received[0], [
    { displayName: 'Alpha', role: 'admin', active: true, uid: 'a' },
    { email: 'z@example.test', role: 'viewer', active: true, uid: 'z' }
  ]);
  const failure = new Error('subscription failed');
  fixture.subscriptions[0].onError(failure);
  assert.deepEqual(errors, [failure]);
  stop();
  assert.equal(fixture.subscriptions[0].stopped, true);
});

test('profile reads and updates target exact /users documents and use updateDoc', async () => {
  const { createProfileService } = await importNativeModule('js/services/profile-service.mjs');
  const fixture = createFixture({ 'users/target': { role: 'viewer', active: true } });
  const service = createProfileService({ db: {}, api: fixture.api });
  const result = await service.readAuthorizationProfile('target');
  assert.equal(result.exists(), true);
  await service.updateAuthorizationProfile('target', { role: 'field_rep', territory: 'East', active: true });
  assert.deepEqual(fixture.events, ['get:users/target', 'update:users/target']);
  assert.deepEqual(fixture.updates[0].changes, { role: 'field_rep', territory: 'East', active: true });
});

test('complete save path preserves Owner, Admin, self, inactive and invalid-profile protections', async () => {
  const { createProfileService } = await importNativeModule('js/services/profile-service.mjs');
  const targets = {
    'users/owner-target': { role: 'owner', active: true },
    'users/admin-target': { role: 'admin', active: true },
    'users/rep-target': { role: 'field_rep', active: true }
  };

  const ownerFixture = createFixture(targets);
  const ownerState = { uid: 'owner-manager', profile: { role: 'owner', active: true } };
  await createProfileService({ db: {}, api: ownerFixture.api }).saveAuthorizationProfile(
    'admin-target', { role: 'field_rep', territory: '  United States  ', active: false }, access(ownerState)
  );
  assert.deepEqual(ownerFixture.events, ['get:users/admin-target', 'update:users/admin-target']);
  assert.deepEqual(ownerFixture.updates[0].changes, { role: 'field_rep', territory: 'United States', active: false });

  const adminFixture = createFixture(targets);
  const adminState = { uid: 'admin-manager', profile: { role: 'admin', active: true } };
  const adminService = createProfileService({ db: {}, api: adminFixture.api });
  await assert.rejects(
    adminService.saveAuthorizationProfile('owner-target', { role: 'owner', territory: '', active: true }, access(adminState)),
    /not authorized to assign this role/
  );
  await assert.rejects(
    adminService.saveAuthorizationProfile('owner-target', { role: 'admin', territory: '', active: true }, access(adminState)),
    /not authorized to edit this authorization profile/
  );

  for (const role of ['owner', 'admin']) {
    const selfFixture = createFixture({ [`users/${role}`]: { role, active: true } });
    const state = { uid: role, profile: { role, active: true } };
    const service = createProfileService({ db: {}, api: selfFixture.api });
    await assert.rejects(service.saveAuthorizationProfile(role, { role: 'viewer', territory: '', active: true }, access(state)), /cannot change your own authorization role/);
    await assert.rejects(service.saveAuthorizationProfile(role, { role, territory: '', active: false }, access(state)), /cannot disable your own authorization profile/);
  }

  for (const profile of [null, { role: 'owner', active: false }, { role: 'invalid', active: true }]) {
    const fixture = createFixture(targets);
    const state = { uid: 'manager', profile };
    await assert.rejects(
      createProfileService({ db: {}, api: fixture.api }).saveAuthorizationProfile('rep-target', { role: 'viewer', territory: '', active: true }, access(state)),
      /not authorized to manage users/
    );
    assert.equal(fixture.events.length, 0);
  }
});

test('deleted targets are not recreated and access changes while getDoc is pending fail closed', async () => {
  const { createProfileService } = await importNativeModule('js/services/profile-service.mjs');
  const manager = { uid: 'owner', profile: { role: 'owner', active: true } };

  const missing = createFixture();
  await assert.rejects(
    createProfileService({ db: {}, api: missing.api }).saveAuthorizationProfile('deleted', { role: 'viewer', territory: '', active: true }, access(manager)),
    /no longer exists/
  );
  assert.deepEqual(missing.events, ['get:users/deleted']);
  assert.equal(missing.updates.length, 0);

  for (const changeAccess of [
    (state) => { state.uid = 'another-user'; },
    (state) => { state.profile = { role: 'viewer', active: true }; }
  ]) {
    const fixture = createFixture({ 'users/target': { role: 'viewer', active: true } });
    const release = fixture.holdRead();
    const state = { uid: 'owner', profile: { role: 'owner', active: true } };
    const pending = createProfileService({ db: {}, api: fixture.api }).saveAuthorizationProfile(
      'target', { role: 'viewer', territory: '', active: true }, access(state)
    );
    changeAccess(state);
    release();
    await assert.rejects(pending, /authorization changed/);
    assert.equal(fixture.updates.length, 0);
  }
});

test('app and authorization UI import the profile service and retain Authorized Users lifecycle guards', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/profile-service.mjs');
  assert(serviceImport, 'profile service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => [node.imported.name, node.local.name]), [
    ['saveAuthorizationProfile', 'saveAuthorizationProfileService']
  ]);
  const localNodes = collectNamedNodes(source, (name) => ['readAuthorizationProfile', 'updateAuthorizationProfile', 'subscribeAuthorizedUsers'].includes(name));
  assert.deepEqual([...localNodes.keys()], []);
  const uiSource = readRepositoryFile('js/components/authorization-ui.mjs');
  const uiAst = parseModule(uiSource);
  const uiServiceImport = uiAst.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === '../services/profile-service.mjs');
  assert(uiServiceImport, 'authorization UI profile service import');
  assert.deepEqual(uiServiceImport.specifiers.map((node) => node.imported.name), ['subscribeAuthorizedUsers']);
  const authorizedUsers = collectNamedNodes(uiSource, (name) => name === 'AuthorizedUsers').get('AuthorizedUsers');
  const componentSource = uiSource.slice(authorizedUsers.start, authorizedUsers.end);
  assert.match(componentSource, /let listening = true/);
  assert.match(componentSource, /if \(!listening\) return/);
  assert.match(componentSource, /listening = false; unsubscribe\(\)/);
});
