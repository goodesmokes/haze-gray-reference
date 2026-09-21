const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule } = require('./test-support.cjs');

const baseForm = {
  name: 'Harbor Shop', contactName: '', email: '', phone: '', address1: '', address2: '',
  city: '', state: '', postalCode: '', country: 'United States', website: '', notes: '', active: true
};

const snapshot = (data) => ({ exists: () => data !== undefined, data: () => data });

function createFixture(documents = {}, options = {}) {
  const events = [];
  const writes = [];
  let generated = 0;
  let timestamp = 0;
  const api = {
    collection: (_db, ...parts) => ({ path: parts.join('/') }),
    doc: (first, ...parts) => {
      if (!parts.length && first?.path) return { path: `${first.path}/generated-${++generated}`, id: `generated-${generated}` };
      const path = parts.join('/');
      return { path, id: parts.at(-1) };
    },
    where: (...args) => ({ type: 'where', args }),
    query: (reference, ...constraints) => ({ reference, constraints }),
    getDocs: async (scope) => {
      events.push(`query:${scope.reference.path}`);
      return { docs: (options.duplicates || []).map((item) => ({ id: item.id, data: () => item })) };
    },
    serverTimestamp: () => `timestamp-${++timestamp}`,
    runTransaction: async (_db, operation) => {
      events.push('transaction');
      const run = async () => operation({
        get: async (reference) => { events.push(`get:${reference.path}`); const result = snapshot(documents[reference.path]); options.afterGet?.(reference); return result; },
        update: (reference, value) => { events.push(`update:${reference.path}`); writes.push({ type: 'update', reference, value }); },
        set: (reference, value) => { events.push(`set:${reference.path}`); writes.push({ type: 'set', reference, value }); }
      });
      if (options.retry) await run();
      return run();
    }
  };
  return { api, events, writes };
}

test('assignment writes read the actor and retailer, preserve stale UIDs, and validate only additions', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  for (const role of ['owner', 'admin']) {
    const documents = {
      'users/manager': { role, active: true },
      'users/rep': { role: 'field_rep', active: true },
      'retailers/r': { assignedRepUids: ['stale'], name: 'Untouched' }
    };
    const fixture = createFixture(documents);
    const service = createRetailerService({ db: {}, auth: { currentUser: { uid: 'manager' } }, api: fixture.api });
    await service.saveRetailerAssignments('r', ['stale', 'rep'], ['stale'], 'manager', () => true);
    assert.deepEqual(fixture.events.slice(1, 4), ['get:users/manager', 'get:retailers/r', 'get:users/rep']);
    assert(!fixture.events.includes('get:users/stale'));
    assert.deepEqual(fixture.writes[0].value.assignedRepUids, ['stale', 'rep']);
    assert.match(fixture.writes[0].value.updatedAt, /^timestamp-/);
  }
});

test('assignment writes detect conflicts, reject new stale users, and support removals', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  const auth = { currentUser: { uid: 'manager' } };
  const baseDocuments = { 'users/manager': { role: 'owner', active: true }, 'retailers/r': { assignedRepUids: ['stale', 'rep'] } };

  const removal = createFixture(baseDocuments);
  await createRetailerService({ db: {}, auth, api: removal.api }).saveRetailerAssignments('r', ['rep'], ['stale', 'rep'], 'manager', () => true);
  assert.deepEqual(removal.writes[0].value.assignedRepUids, ['rep']);

  const conflict = createFixture(baseDocuments);
  await assert.rejects(createRetailerService({ db: {}, auth, api: conflict.api }).saveRetailerAssignments('r', [], ['different'], 'manager', () => true), /Assignments changed/);
  assert.equal(conflict.writes.length, 0);

  for (const data of [undefined, { role: 'viewer', active: true }, { role: 'field_rep', active: false }]) {
    const fixture = createFixture({ ...baseDocuments, 'users/new-user': data });
    await assert.rejects(createRetailerService({ db: {}, auth, api: fixture.api }).saveRetailerAssignments('r', ['stale', 'rep', 'new-user'], ['stale', 'rep'], 'manager', () => true), /active Owner, Admin, or Field Rep/);
    assert.equal(fixture.writes.length, 0);
  }
});

test('Auth UID changes before assignment or retailer writes abort the transaction', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  for (const operation of ['assignment', 'retailer']) {
    const auth = { currentUser: { uid: 'manager' } };
    const documents = { 'users/manager': { role: 'owner', active: true }, 'retailers/r': { assignedRepUids: [], active: true } };
    const fixture = createFixture(documents, { afterGet: (reference) => { if (reference.path === 'retailers/r') auth.currentUser = { uid: 'other' }; } });
    const service = createRetailerService({ db: {}, auth, api: fixture.api });
    const action = operation === 'assignment'
      ? service.saveRetailerAssignments('r', [], [], 'manager', () => true)
      : service.saveRetailerProfile('r', { ...baseForm, city: 'Updated' }, 'manager', () => true);
    await assert.rejects(action, /access changed/);
    assert.equal(fixture.writes.length, 0);
  }
});

test('retailer creation preserves United States, audit fields, assignments and generated ID', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  const documents = {
    'users/owner': { role: 'owner', active: true, displayName: 'Owner', territory: 'United States' },
    'users/rep': { role: 'field_rep', active: true }
  };
  const fixture = createFixture(documents);
  const service = createRetailerService({ db: {}, auth: { currentUser: { uid: 'owner' } }, api: fixture.api });
  const id = await service.saveRetailerProfile(null, { ...baseForm, territory: 'United States', assignedRepUids: ['rep'] }, 'owner', () => true);
  assert.equal(id, 'generated-1');
  const value = fixture.writes[0].value;
  assert.equal(value.territory, 'United States');
  assert.equal(value.territoryNormalized, 'united states');
  assert.deepEqual(value.assignedRepUids, ['rep']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.creatorUid, 'owner');
  assert.equal(value.creatorDisplayName, 'Owner');
  assert.match(value.createdAt, /^timestamp-/);
  assert.match(value.updatedAt, /^timestamp-/);
  assert.equal(value.name, 'Harbor Shop');
});

test('generated retailer reference remains stable across transaction retry', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  const fixture = createFixture({ 'users/rep': { role: 'field_rep', active: true, displayName: 'Rep', territory: 'United States' } }, { retry: true });
  const service = createRetailerService({ db: {}, auth: { currentUser: { uid: 'rep' } }, api: fixture.api });
  const id = await service.saveRetailerProfile(null, baseForm, 'rep', () => true);
  assert.equal(id, 'generated-1');
  assert.equal(fixture.writes.length, 2);
  assert.deepEqual(fixture.writes.map((write) => write.reference.path), ['retailers/generated-1', 'retailers/generated-1']);
});

test('role-specific territory and status restrictions remain unchanged', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  const auth = { currentUser: { uid: 'rep' } };
  const documents = { 'users/rep': { role: 'field_rep', active: true, displayName: 'Rep', territory: 'United States' }, 'retailers/r': { active: true } };

  const created = createFixture(documents);
  await createRetailerService({ db: {}, auth, api: created.api }).saveRetailerProfile(null, baseForm, 'rep', () => true);
  assert.equal(created.writes[0].value.territory, 'United States');
  assert.equal(created.writes[0].value.territoryNormalized, 'united states');

  await assert.rejects(createRetailerService({ db: {}, auth, api: createFixture(documents).api }).saveRetailerProfile(null, { ...baseForm, territory: 'West' }, 'rep', () => true), /current user profile/);
  await assert.rejects(createRetailerService({ db: {}, auth, api: createFixture(documents).api }).saveRetailerProfile('r', { ...baseForm, territory: 'West' }, 'rep', () => true), /change retailer territory/);
  await assert.rejects(createRetailerService({ db: {}, auth, api: createFixture(documents).api }).saveRetailerProfile('r', { ...baseForm, active: false }, 'rep', () => true), /status/);

  for (const role of ['owner', 'admin']) {
    const managerAuth = { currentUser: { uid: role } };
    const managerDocuments = { [`users/${role}`]: { role, active: true, displayName: role, territory: 'East' }, 'retailers/r': { active: false } };
    const fixture = createFixture(managerDocuments);
    await createRetailerService({ db: {}, auth: managerAuth, api: fixture.api }).saveRetailerProfile('r', { ...baseForm, active: true, territory: 'United States' }, role, () => true);
    const value = fixture.writes[0].value;
    assert.equal(value.active, true);
    assert.equal(value.territory, 'United States');
    assert(!Object.hasOwn(value, 'creatorUid'));
    assert(!Object.hasOwn(value, 'createdAt'));
  }
});

test('duplicate detection remains advisory and outside the transaction', async () => {
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
  const fixture = createFixture({ 'users/rep': { role: 'field_rep', active: true, displayName: 'Rep', territory: 'United States' } }, { duplicates: [{ id: 'existing', name: 'Harbor Shop', nameNormalized: 'harbor shop', active: true }] });
  const service = createRetailerService({ db: {}, auth: { currentUser: { uid: 'rep' } }, api: fixture.api });
  await assert.rejects(service.saveRetailerProfile(null, baseForm, 'rep', () => true), (error) => error.retailerId === 'existing');
  assert.deepEqual(fixture.events, ['query:retailers']);
  assert.equal(fixture.writes.length, 0);
});

test('index imports retailer write service without duplicate declarations', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/retailer-service.mjs');
  assert(serviceImport, 'retailer service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => node.imported.name), ['saveRetailerAssignments', 'saveRetailerProfile']);
  const localNodes = collectNamedNodes(source, (name) => ['checkNewRepAssignments', 'saveRetailerAssignments', 'saveRetailerProfile'].includes(name));
  assert.deepEqual([...localNodes.keys()], []);
});
