const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule } = require('./test-support.cjs');

const image = '/haze-gray-reference/assets/cigars/1982.webp';
const record = (overrides = {}) => ({
  id: '1982', name: '1982', line: 'Core', imageUrl: image,
  wrapper: 'Shade', binder: 'Dominican', filler: 'Dominican', origin: '',
  strength: 1, body: 1, tastingNotes: ['Cream'], pairings: ['Coffee'], notes: 'Public note',
  sizes: [{
    key: 'robusto', vitola: 'Robusto', dims: '50 x 5', msrp: '$12.40',
    keystoneSingle: '$6.45 box', keystoneBox10: '$64.50', keystoneBox20: '$129.00', keystoneBundle20: '$124.00',
    pricing: { msrp: 12.4, boxSingle: 6.45, bundleSingle: null, box10: 64.5, box20: 129, bundle20: 124 }
  }],
  ...overrides
});

test('public catalog projection retains canonical current and legacy pricing fields only', async () => {
  const { projectPublicCatalog } = await importNativeModule('js/domain/catalog-snapshot.mjs');
  const projected = projectPublicCatalog([{ ...record(), role: 'owner', retailer: { secret: true }, sizes: [{ ...record().sizes[0], privateMargin: 99, pricing: { ...record().sizes[0].pricing, secret: 1 } }] }]);
  assert.deepEqual(Object.keys(projected[0]), ['id', 'name', 'line', 'imageUrl', 'wrapper', 'binder', 'filler', 'origin', 'strength', 'body', 'tastingNotes', 'pairings', 'sizes', 'notes']);
  assert.equal(projected[0].role, undefined);
  assert.equal(projected[0].retailer, undefined);
  assert.equal(projected[0].sizes[0].privateMargin, undefined);
  assert.equal(projected[0].sizes[0].pricing.secret, undefined);
  assert.deepEqual(projected[0].sizes[0].pricing, record().sizes[0].pricing);
});

test('Firestore document identity, image paths, uniqueness and complete validation are enforced', async () => {
  const { projectPublicCatalog } = await importNativeModule('js/domain/catalog-snapshot.mjs');
  assert.equal(projectPublicCatalog([{ ...record(), storedId: 'ignored' }])[0].id, '1982');
  for (const invalid of [
    [{ ...record(), id: '' }],
    [{ ...record(), id: 'bad/id' }],
    [record(), record()],
    [{ ...record(), imageUrl: 'https://example.com/cigar.webp' }],
    [{ ...record(), name: null }],
    [{ ...record(), sizes: [{ ...record().sizes[0], pricing: { msrp: Infinity } }] }]
  ]) assert.throws(() => projectPublicCatalog(invalid));
  assert.throws(() => projectPublicCatalog([record(), { ...record({ id: 'broken' }), sizes: null }]), /sizes/);
});

test('trusted events require a complete server result without pending writes', async () => {
  const { isTrustedCatalogEvent, createCatalogSnapshot } = await importNativeModule('js/domain/catalog-snapshot.mjs');
  const trusted = { complete: true, metadata: { fromCache: false, hasPendingWrites: false }, records: [record()] };
  assert.equal(isTrustedCatalogEvent(trusted), true);
  for (const event of [
    { ...trusted, complete: false },
    { ...trusted, metadata: { fromCache: true, hasPendingWrites: false } },
    { ...trusted, metadata: { fromCache: false, hasPendingWrites: true } }
  ]) {
    assert.equal(isTrustedCatalogEvent(event), false);
    assert.throws(() => createCatalogSnapshot(event));
  }
  const snapshot = createCatalogSnapshot(trusted, new Date('2026-09-26T12:00:00Z'));
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.serverConfirmedAt, '2026-09-26T12:00:00.000Z');
  assert.equal(snapshot.confirmedEmpty, false);
});

test('server-confirmed empty catalog is explicit and malformed documents reject the whole candidate', async () => {
  const { createCatalogSnapshot } = await importNativeModule('js/domain/catalog-snapshot.mjs');
  const metadata = { fromCache: false, hasPendingWrites: false };
  const empty = createCatalogSnapshot({ complete: true, metadata, records: [] });
  assert.deepEqual(empty.records, []);
  assert.equal(empty.confirmedEmpty, true);
  assert.throws(() => createCatalogSnapshot({ complete: true, metadata, records: [record(), { ...record({ id: 'bad' }), imageUrl: 'data:image/png;base64,abc' }] }));
});

test('stored snapshots reject schema mismatch, corruption, unknown and protected fields', async () => {
  const { createCatalogSnapshot, validateCatalogSnapshot } = await importNativeModule('js/domain/catalog-snapshot.mjs');
  const good = createCatalogSnapshot({ complete: true, metadata: { fromCache: false, hasPendingWrites: false }, records: [record()] });
  assert.deepEqual(validateCatalogSnapshot(good), good);
  for (const invalid of [
    { ...good, schemaVersion: 2 },
    { ...good, confirmedEmpty: true },
    { ...good, serverConfirmedAt: 'not-a-date' },
    { ...good, user: { uid: 'secret' } },
    { ...good, records: [Object.fromEntries(Object.entries(good.records[0]).filter(([key]) => key !== 'notes'))] },
    { ...good, records: [{ ...good.records[0], notes: undefined }] },
    { ...good, records: [{ ...good.records[0], role: 'owner' }] },
    { ...good, records: [{ ...good.records[0], sizes: [{ ...good.records[0].sizes[0], customer: 'private' }] }] }
  ]) assert.throws(() => validateCatalogSnapshot(invalid));
});
