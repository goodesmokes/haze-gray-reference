const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule, readRepositoryFile } = require('./test-support.cjs');

const profile = { active: true, role: 'field_rep', displayName: 'Rep' };
const packs = [{ key: 'box10', label: '10ct Box' }];
const currentCatalog = [{ id: 'cigar', name: 'Cigar', sizes: [{ key: 'size', vitola: 'Robusto', dims: '50 x 5', pricing: { box10: 65, msrp: 13 } }] }];
const legacyCatalog = [{ id: 'cigar', name: 'Cigar', sizes: [{ key: 'size', vitola: 'Robusto', dims: '50 x 5', keystoneBox10: '$65.00', msrp: '$13.00' }] }];
const line = (index = '') => ({ lineKey: `cigar__size${index}__box10`, cigarId: 'cigar', cigarName: 'Cigar', sizeKey: `size${index}`, vitola: 'Robusto', dims: '50 x 5', packKey: 'box10', packLabel: '10ct Box', unitPrice: 60, retailUnitValue: 130, qty: 1 });

async function makePending(uid = 'rep', lines = [line()]) {
  const { buildSavedOrder } = await importNativeModule('js/domain/saved-orders.mjs');
  return {
    uid,
    id: 'A1234567890123456789',
    payload: buildSavedOrder({ orderItems: lines, orderRetailer: 'Shop', orderEmail: '', orderNotes: '' }, { uid }, profile)
  };
}

function fakeApi(options = {}) {
  const events = [];
  const timestamp = { marker: 'server-timestamp' };
  const api = {
    collection: (_db, ...parts) => ({ type: 'collection', path: parts.join('/') }),
    doc: (_db, ...parts) => ({ type: 'doc', path: parts.join('/') }),
    where: (...args) => ({ type: 'where', args }),
    orderBy: (...args) => ({ type: 'orderBy', args }),
    query: (reference, ...constraints) => ({ type: 'query', reference, constraints }),
    onSnapshot: (scope, success, error) => { options.subscription = { scope, success, error, stopped: false }; return () => { options.subscription.stopped = true; }; },
    serverTimestamp: () => timestamp,
    runTransaction: async (_db, operation) => {
      const transaction = {
        get: async (reference) => {
          events.push(`get:${reference.path}`);
          if (reference.path.startsWith('orders/')) return options.existing || { exists: () => false };
          if (reference.path.startsWith('users/')) return options.profile || { exists: () => true, data: () => profile };
          throw new Error(`Unexpected read ${reference.path}`);
        },
        set: (reference, value) => { events.push(`set:${reference.path}`); options.write = { reference, value }; }
      };
      return operation(transaction);
    }
  };
  return { api, events, timestamp };
}

test('history subscription preserves manager and creator query scopes', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  for (const allOrders of [true, false]) {
    const options = {}, { api } = fakeApi(options);
    const service = createOrderService({ db: {}, auth: { currentUser: { uid: 'rep' } }, api });
    const unsubscribe = service.subscribeOrderHistory({ allOrders, uid: 'rep' }, () => {}, () => {});
    assert.equal(typeof unsubscribe, 'function');
    assert.equal(options.subscription.scope.reference.path, 'orders');
    assert.deepEqual(options.subscription.scope.constraints, allOrders
      ? [{ type: 'orderBy', args: ['savedAt', 'desc'] }]
      : [{ type: 'where', args: ['creatorUid', '==', 'rep'] }, { type: 'orderBy', args: ['savedAt', 'desc'] }]);
    unsubscribe();
    assert.equal(options.subscription.stopped, true);
  }
});

test('history subscription maps snapshots, preserves timestamps and excludes pending or malformed records', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const pending = await makePending();
  const savedAt = { toDate: () => new Date(0) };
  const valid = { ...pending.payload, savedAt };
  const malformed = { ...valid, lineItems: [] };
  const options = {}, { api } = fakeApi(options);
  const service = createOrderService({ db: {}, auth: { currentUser: { uid: 'rep' } }, api });
  let result;
  let failure;
  service.subscribeOrderHistory({ allOrders: false, uid: 'rep' }, (records, malformedCount) => { result = { records, malformedCount }; }, (error) => { failure = error; });
  options.subscription.success({ docs: [
    { id: 'valid', metadata: { hasPendingWrites: false }, data: () => valid },
    { id: 'pending', metadata: { hasPendingWrites: true }, data: () => valid },
    { id: 'foreign', metadata: { hasPendingWrites: false }, data: () => ({ ...valid, creatorUid: 'other' }) },
    { id: 'malformed', metadata: { hasPendingWrites: false }, data: () => malformed }
  ] });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'valid');
  assert.equal(result.records[0].savedAt, savedAt);
  assert.equal(result.malformedCount, 1);
  const error = new Error('history failed');
  options.subscription.error(error);
  assert.equal(failure, error);
});

test('save transaction preserves read ordering, fresh profile authorization and server timestamp', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const pending = await makePending();
  const auth = { currentUser: { uid: 'rep' } };
  const options = {}, fixture = fakeApi(options);
  const service = createOrderService({ db: {}, auth, api: fixture.api });
  await service.savePendingOrder(pending, 'rep', () => true, currentCatalog, packs);
  assert.deepEqual(fixture.events, [`get:orders/${pending.id}`, 'get:users/rep', `set:orders/${pending.id}`]);
  assert.equal(options.write.value.savedAt, fixture.timestamp);
  assert.equal(options.write.value.creatorUid, 'rep');
  assert.equal(options.write.value.lineItems[0].unitPrice, 60);

  const denied = fakeApi({ profile: { exists: () => true, data: () => ({ ...profile, active: false }) } });
  await assert.rejects(createOrderService({ db: {}, auth, api: denied.api }).savePendingOrder(pending, 'rep', () => true, currentCatalog, packs), /not authorized/);
  assert.deepEqual(denied.events, [`get:orders/${pending.id}`, 'get:users/rep']);
});

test('idempotent retries do not rewrite matching orders and reject foreign IDs', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const pending = await makePending();
  const auth = { currentUser: { uid: 'rep' } };
  for (const [creatorUid, rejected] of [['rep', false], ['other', true]]) {
    const options = { existing: { exists: () => true, data: () => ({ creatorUid }) } }, fixture = fakeApi(options);
    const operation = createOrderService({ db: {}, auth, api: fixture.api }).savePendingOrder(pending, 'rep', () => true, [], packs);
    if (rejected) await assert.rejects(operation, /another account/); else await operation;
    assert.deepEqual(fixture.events, [`get:orders/${pending.id}`]);
    assert.equal(options.write, undefined);
  }
});

test('Auth UID changes are rejected at entry and at both transaction rechecks', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const pending = await makePending();
  const entryAuth = { currentUser: { uid: 'other' } };
  await assert.rejects(createOrderService({ db: {}, auth: entryAuth, api: fakeApi().api }).savePendingOrder(pending, 'rep', () => true, currentCatalog, packs), /not authorized/);

  for (const changeAtCheck of [2, 3]) {
    const auth = { currentUser: { uid: 'rep' } };
    const fixture = fakeApi({});
    let checks = 0;
    const permitted = () => {
      checks++;
      if (checks === changeAtCheck) auth.currentUser = { uid: 'other' };
      return true;
    };
    await assert.rejects(createOrderService({ db: {}, auth, api: fixture.api }).savePendingOrder(pending, 'rep', permitted, currentCatalog, packs), /access changed/);
    assert.equal(fixture.events.includes(`set:orders/${pending.id}`), false);
  }
});

test('service preserves 100-line success and 101-line rejection', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const sizes = Array.from({ length: 101 }, (_, index) => ({ key: `size${index}`, vitola: 'Robusto', dims: '50 x 5', pricing: { box10: 65, msrp: 13 } }));
  const catalog = [{ id: 'cigar', name: 'Cigar', sizes }];
  const hundredLines = Array.from({ length: 100 }, (_, index) => line(index));
  const pending = await makePending('rep', hundredLines);
  const auth = { currentUser: { uid: 'rep' } };
  const successOptions = {}, success = fakeApi(successOptions);
  await createOrderService({ db: {}, auth, api: success.api }).savePendingOrder(pending, 'rep', () => true, catalog, packs);
  assert.equal(successOptions.write.value.lineItems.length, 100);

  const invalid = { ...pending, id: 'B1234567890123456789', payload: { ...pending.payload, lineItems: [...pending.payload.lineItems, { ...line(100) }] } };
  await assert.rejects(createOrderService({ db: {}, auth, api: fakeApi({}).api }).savePendingOrder(invalid, 'rep', () => true, catalog, packs), /1 and 100/);
});

test('service accepts current and legacy prices and rejects unavailable configurations', async () => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const pending = await makePending();
  const auth = { currentUser: { uid: 'rep' } };
  for (const catalog of [currentCatalog, legacyCatalog]) {
    const options = {}, fixture = fakeApi(options);
    await createOrderService({ db: {}, auth, api: fixture.api }).savePendingOrder(pending, 'rep', () => true, catalog, packs);
    assert.equal(options.write.value.lineItems[0].unitPrice, 60);
  }
  await assert.rejects(createOrderService({ db: {}, auth, api: fakeApi({}).api }).savePendingOrder(pending, 'rep', () => true, [], packs), /no longer available/);
  await assert.rejects(createOrderService({ db: {}, auth, api: fakeApi({}).api }).savePendingOrder(pending, 'rep', () => true, currentCatalog, []), /no longer available/);
});

test('index imports order service without duplicate service declarations', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/order-service.mjs');
  assert(serviceImport, 'order service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => node.imported.name), ['savePendingOrder']);
  const historySource = readRepositoryFile('js/components/order-history.mjs');
  const historyImport = parseModule(historySource).program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === '../services/order-service.mjs');
  assert.deepEqual(historyImport.specifiers.map((node) => node.imported.name), ['subscribeOrderHistory']);
  const localNodes = collectNamedNodes(source, (name) => ['savePendingOrder', 'subscribeOrderHistory'].includes(name));
  assert.deepEqual([...localNodes.keys()], []);
  assert.deepEqual([...collectNamedNodes(historySource, (name) => ['savePendingOrder', 'subscribeOrderHistory'].includes(name)).keys()], []);
});
