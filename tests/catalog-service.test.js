const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, nodeText, parseModule } = require('./test-support.cjs');

const createFakeApi = () => {
  const state = { snapshots: [], gets: [], sets: [], deletes: [] };
  const api = {
    collection: (_db, ...segments) => ({ path: segments.join('/') }),
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    onSnapshot: (reference, onRecords, onError) => {
      const subscription = { reference, onRecords, onError, stopped: false };
      state.snapshots.push(subscription);
      return () => { subscription.stopped = true; };
    },
    getDocs: async (reference) => { state.gets.push(reference); return state.catalogSnapshot; },
    getDoc: async (reference) => { state.gets.push(reference); return state.legacySnapshot; },
    setDoc: async (reference, value) => { state.sets.push({ reference, value }); },
    deleteDoc: async (reference) => { state.deletes.push(reference); }
  };
  return { api, state };
};

test('catalog service preserves collection paths, subscription mapping and errors', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  const { api, state } = createFakeApi();
  const service = createCatalogService({ name: 'test-db' }, api);
  assert.equal(service.CIGARS_COL.path, 'cigars');
  assert.equal(service.LEGACY_DOC.path, 'app-data/cigars');

  let records;
  let failure;
  const unsubscribe = service.subscribeCatalog((value) => { records = value; }, (error) => { failure = error; });
  assert.equal(typeof unsubscribe, 'function');
  assert.equal(state.snapshots[0].reference.path, 'cigars');
  state.snapshots[0].onRecords({ docs: [
    { id: 'one', data: () => ({ name: 'First', imageUrl: 'data:image/png;base64,abc' }) },
    { id: 'two', data: () => ({ id: 'stored-id', name: 'Second' }) }
  ] });
  assert.deepEqual(records, [
    { name: 'First', imageUrl: 'data:image/png;base64,abc', id: 'one' },
    { id: 'two', name: 'Second' }
  ]);
  const expectedError = new Error('listener failed');
  state.snapshots[0].onError(expectedError);
  assert.equal(failure, expectedError);
  unsubscribe();
  assert.equal(state.snapshots[0].stopped, true);
});

test('catalog service saves and deletes exact cigar document paths without transforming records', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  const { api, state } = createFakeApi();
  const service = createCatalogService({}, api);
  const record = { id: 'cigar-id', name: 'Cigar', imageUrl: 'data:image/jpeg;base64,xyz', sizes: [{ key: 'size', msrp: '$12.00' }], legacyField: true };
  await service.saveCatalogRecord(record);
  assert.equal(state.sets[0].reference.path, 'cigars/cigar-id');
  assert.equal(state.sets[0].value, record);
  assert.deepEqual(state.sets[0].value, record);
  await service.deleteCatalogRecord('cigar-id');
  assert.equal(state.deletes[0].path, 'cigars/cigar-id');
});

test('migration availability requires an empty catalog and a populated legacy payload', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  for (const [empty, exists, payload, expected] of [
    [true, true, '[{}]', true],
    [false, true, '[{}]', false],
    [true, false, '[{}]', false],
    [true, true, '', false]
  ]) {
    const { api, state } = createFakeApi();
    state.catalogSnapshot = { empty };
    state.legacySnapshot = { exists: () => exists, data: () => ({ payload }) };
    const service = createCatalogService({}, api);
    assert.equal(await service.isLegacyCatalogMigrationAvailable(), expected);
    assert.deepEqual(state.gets.map((reference) => reference.path), ['cigars', 'app-data/cigars']);
  }
});

test('legacy payload parsing preserves records and rejects malformed JSON', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  const record = { id: 'legacy', imageUrl: 'data:image/png;base64,legacy', sizes: [{ key: 'original' }], custom: { unchanged: true } };
  const valid = createFakeApi();
  valid.state.legacySnapshot = { exists: () => true, data: () => ({ payload: JSON.stringify([record]) }) };
  assert.deepEqual(await createCatalogService({}, valid.api).readLegacyCatalog(), [record]);

  const malformed = createFakeApi();
  malformed.state.legacySnapshot = { exists: () => true, data: () => ({ payload: '{bad json' }) };
  await assert.rejects(createCatalogService({}, malformed.api).readLegacyCatalog(), SyntaxError);

  const missing = createFakeApi();
  missing.state.legacySnapshot = { exists: () => false, data: () => ({ payload: JSON.stringify([record]) }) };
  assert.equal(await createCatalogService({}, missing.api).readLegacyCatalog(), null);
});

function loadMigrationHandler(environment) {
  const source = extractInlineModule();
  const nodes = collectNamedNodes(source, (name) => name === 'migrateLegacyData');
  return Function(...Object.keys(environment), `return ${nodeText(source, nodes, 'migrateLegacyData')};`)(...Object.values(environment));
}

test('migration orchestration keeps writes sequential and preserves each record', async () => {
  const records = [{ id: 'a', imageUrl: 'first' }, { id: 'b', imageUrl: 'second' }, { id: 'c', imageUrl: 'third' }];
  const writes = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const migrate = loadMigrationHandler({
    requirePermission: () => true,
    accessRef: { current: { uid: 'owner' } },
    setMigrating: () => {}, setCanMigrate: () => {}, setError: () => {},
    readLegacyCatalog: async () => records,
    saveCatalogRecord: async (record) => {
      activeWrites++;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 1));
      writes.push(record);
      activeWrites--;
    }
  });
  await migrate();
  assert.equal(maximumActiveWrites, 1);
  assert.deepEqual(writes, records);
  assert.equal(writes[0], records[0]);
});

test('migration can stop between records after permission or acting-UID loss', async () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const run = async (mode) => {
    const accessRef = { current: { uid: 'owner' } };
    const writes = [];
    let checks = 0;
    const migrate = loadMigrationHandler({
      requirePermission: () => ++checks < (mode === 'permission' ? 3 : 99),
      accessRef,
      setMigrating: () => {}, setCanMigrate: () => {}, setError: () => {},
      readLegacyCatalog: async () => records,
      saveCatalogRecord: async (record) => {
        writes.push(record);
        if (mode === 'uid') accessRef.current.uid = 'other';
      }
    });
    await migrate();
    return writes;
  };
  assert.deepEqual(await run('permission'), [records[0]]);
  assert.deepEqual(await run('uid'), [records[0]]);
});

test('index imports the catalog service without local catalog references', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/catalog-service.mjs');
  assert(serviceImport, 'catalog service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => node.imported.name), [
    'subscribeCatalog', 'isLegacyCatalogMigrationAvailable', 'saveCatalogRecord', 'deleteCatalogRecord', 'readLegacyCatalog'
  ]);
  const localNodes = collectNamedNodes(source, (name) => ['CIGARS_COL', 'LEGACY_DOC'].includes(name));
  assert.deepEqual([...localNodes.keys()], []);
});
