const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule } = require('./test-support.cjs');

function fakeIndexedDb({ initial, openError, putError } = {}) {
  const state = { value: initial, opens: [], stores: new Set() };
  const database = {
    objectStoreNames: { contains: name => state.stores.has(name) },
    createObjectStore: name => state.stores.add(name),
    close: () => {},
    transaction: (_name, mode) => {
      const transaction = { error: null };
      transaction.objectStore = () => ({
        get: key => {
          const request = {};
          queueMicrotask(() => { request.result = key === 'current' ? structuredClone(state.value) : undefined; request.onsuccess?.(); });
          return request;
        },
        put: (value, key) => {
          queueMicrotask(() => {
            if (putError) { transaction.error = putError; transaction.onabort?.(); return; }
            if (mode === 'readwrite' && key === 'current') state.value = structuredClone(value);
            transaction.oncomplete?.();
          });
        }
      });
      return transaction;
    }
  };
  return {
    state,
    open: (name, version) => {
      state.opens.push([name, version]);
      const request = {};
      queueMicrotask(() => {
        if (openError) { request.error = openError; request.onerror?.(); return; }
        request.result = database;
        if (!state.stores.has('public-catalog')) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

const goodSnapshot = {
  schemaVersion: 1,
  serverConfirmedAt: '2026-09-26T12:00:00.000Z',
  confirmedEmpty: false,
  records: [{ id: 'one', name: 'One', line: '', imageUrl: '', wrapper: '', binder: '', filler: '', origin: '', strength: 1, body: 1, tastingNotes: [], pairings: [], sizes: [], notes: '' }]
};

test('IndexedDB store uses the approved database, version, store and fixed record key', async () => {
  const { createCatalogSnapshotStore } = await importNativeModule('js/services/catalog-snapshot-store.mjs');
  const indexedDb = fakeIndexedDb();
  const store = createCatalogSnapshotStore(indexedDb);
  assert.equal(await store.load(), null);
  await store.replace(goodSnapshot);
  assert.deepEqual(await store.load(), goodSnapshot);
  assert.deepEqual(indexedDb.state.opens, [['haze-gray-reference', 1], ['haze-gray-reference', 1], ['haze-gray-reference', 1]]);
  assert(indexedDb.state.stores.has('public-catalog'));
});

test('replacement validates first and commits the complete envelope atomically', async () => {
  const { createCatalogSnapshotStore } = await importNativeModule('js/services/catalog-snapshot-store.mjs');
  const quota = new Error('quota exceeded');
  const indexedDb = fakeIndexedDb({ initial: goodSnapshot, putError: quota });
  const store = createCatalogSnapshotStore(indexedDb);
  const replacement = { ...goodSnapshot, serverConfirmedAt: '2026-09-27T12:00:00.000Z', records: [] , confirmedEmpty: true };
  await assert.rejects(store.replace(replacement), /quota/);
  assert.deepEqual(indexedDb.state.value, goodSnapshot, 'failed replacement preserves the previous complete record');
  await assert.rejects(store.replace({ ...replacement, schemaVersion: 2 }), /schema/);
  assert.deepEqual(indexedDb.state.value, goodSnapshot);
});

test('corrupt or unsupported stored data behaves as no snapshot and future good data can replace it', async () => {
  const { createCatalogSnapshotStore } = await importNativeModule('js/services/catalog-snapshot-store.mjs');
  for (const initial of [{ ...goodSnapshot, schemaVersion: 2 }, { broken: true }, { ...goodSnapshot, records: 'bad' }]) {
    const indexedDb = fakeIndexedDb({ initial });
    const store = createCatalogSnapshotStore(indexedDb);
    assert.equal(await store.load(), null);
    await store.replace(goodSnapshot);
    assert.deepEqual(await store.load(), goodSnapshot);
  }
});

test('IndexedDB unavailable and open failures reject without changing online catalog behavior', async () => {
  const { createCatalogSnapshotStore } = await importNativeModule('js/services/catalog-snapshot-store.mjs');
  await assert.rejects(createCatalogSnapshotStore(undefined).load(), /unavailable/);
  await assert.rejects(createCatalogSnapshotStore(fakeIndexedDb({ openError: new Error('blocked') })).replace(goodSnapshot), /blocked/);
});
