const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule, extractInlineModule, parseModule, traverse } = require('./test-support.cjs');
let client;
test.before(async () => { client = await importNativeModule('js/domain/saved-orders.mjs'); });
const profile = { active: true, role: 'field_rep', displayName: 'Rep' }, user = { uid: 'rep' };
const line = { lineKey: '1982__1982-robusto__box10', cigarId: '1982', cigarName: '1982', sizeKey: '1982-robusto', vitola: 'Robusto', dims: '50 x 5', packKey: 'box10', packLabel: '10ct Box', qty: 2, unitPrice: 60, retailUnitValue: 124 };
const draft = (lines = [line]) => ({ orderItems: lines, orderRetailer: ' Test Shop ', orderEmail: '', orderNotes: '' });
test('snapshots preserve draft values and reject invalid amounts, strings and quantities', () => {
  const d = draft(), before = JSON.stringify(d), saved = client.buildSavedOrder(d, user, profile);
  assert.equal(saved.totals.wholesaleTotal, 120); assert.equal(saved.retailerNameNormalized, 'test shop'); assert.equal(JSON.stringify(d), before);
  for (const qty of [0, -1, 1.2, Infinity, 1000001]) assert.throws(() => client.buildSavedOrder(draft([{ ...line, qty }]), user, profile));
  for (const unitPrice of [NaN, Infinity, -1, '60']) assert.throws(() => client.buildSavedOrder(draft([{ ...line, unitPrice }]), user, profile));
  assert.throws(() => client.buildSavedOrder({ ...d, orderNotes: 'x'.repeat(10001) }, user, profile));
  assert.throws(() => client.buildSavedOrder(draft([line, line]), user, profile));
});
test('100 distinct lines succeed and 101/empty are rejected', () => {
  const lines = Array.from({ length: 100 }, (_, i) => ({ ...line, sizeKey: 's'+i, lineKey: `1982__s${i}__box10` }));
  assert.equal(client.buildSavedOrder(draft(lines), user, profile).lineItems.length, 100);
  assert.throws(() => client.buildSavedOrder(draft([...lines, { ...line }]), user, profile));
  assert.throws(() => client.buildSavedOrder(draft([]), user, profile));
});

test('history rejects malformed line shapes without changing valid historical values', () => {
  const saved = client.buildSavedOrder(draft(), user, profile), before = JSON.stringify(saved);
  assert.equal(client.isReadableSavedOrder(saved), true);
  assert.equal(JSON.stringify(saved), before);
  for (const invalid of [null, 123, { ...saved.lineItems[0], cigarName: {} }, { ...saved.lineItems[0], qty: {} }]) {
    assert.equal(Boolean(client.isReadableSavedOrder({ ...saved, lineItems: [invalid] })), false);
  }
  assert.equal(client.isReadableSavedOrder({ ...saved, retailerName: undefined }), true);
});
test('UTF-8 document byte limit rejects large snapshots', () => {
  const large = 'ࠀ'.repeat(500), cigarId = 'ࠀ'.repeat(230);
  const lines = Array.from({ length: 100 }, (_, i) => { const sizeKey = 'ࠀ'.repeat(245)+i; return { ...line, cigarId, sizeKey, lineKey: `${cigarId}__${sizeKey}__box10`, cigarName: large, vitola: large, dims: large, packLabel: large }; });
  assert.throws(() => client.buildSavedOrder({ ...draft(lines), orderNotes: 'ࠀ'.repeat(10000) }, user, profile), /document size/);
});

test('saved-order module handles retailer linkage and current/legacy reorder pricing', () => {
  assert.equal(Object.hasOwn(client.buildSavedOrder(draft(), user, profile), 'retailerId'), false);
  assert.equal(client.buildSavedOrder({ ...draft(), retailerId: 'retailer-1' }, user, profile).retailerId, 'retailer-1');
  for (const retailerId of ['bad/id', 'x'.repeat(129), 42]) assert.throws(() => client.buildSavedOrder({ ...draft(), retailerId }, user, profile), /retailer link/);

  const order = client.buildSavedOrder(draft(), user, profile);
  const packs = [{ key: 'box10', label: '10ct Box' }];
  const current = [{ id: '1982', name: '1982', sizes: [{ key: '1982-robusto', vitola: 'Robusto', dims: '50 x 5', pricing: { msrp: 12.4, box10: 64.5 } }] }];
  const legacy = [{ id: '1982', name: '1982', sizes: [{ key: '1982-robusto', vitola: 'Robusto', dims: '50 x 5', msrp: '$12.40', keystoneBox10: '$64.50' }] }];
  for (const cigars of [current, legacy]) {
    const plan = client.buildReorderPlan(order, cigars, packs, [line]);
    assert.equal(plan.available[0].historicalPrice, 60);
    assert.equal(plan.available[0].activePrice, 60);
    assert.equal(plan.available[0].line.unitPrice, 64.5);
    assert.equal(plan.available[0].line.retailUnitValue, 124);
  }
  assert.equal(client.buildReorderPlan(order, [], packs, []).unavailable[0].reason, 'Product unavailable');
});

test('duplicate reorder lines merge without mutating inputs', () => {
  const active = [{ ...line, qty: 2, unitPrice: 60 }], incoming = [{ ...line, qty: 3, unitPrice: 64.5 }];
  const before = JSON.stringify([active, incoming]), merged = client.mergeReorderItems(active, incoming);
  assert.equal(merged[0].qty, 5);
  assert.equal(merged[0].unitPrice, 64.5);
  assert.equal(JSON.stringify([active, incoming]), before);
  assert.throws(() => client.mergeReorderItems([{ ...line, qty: Number.MAX_SAFE_INTEGER }], [{ ...line, qty: 1 }]), /Combined quantity/);
});

test('index imports saved orders without duplicate local declarations', () => {
  const ast = parseModule(extractInlineModule()), local = new Set();
  traverse(ast, {
    FunctionDeclaration(p) { local.add(p.node.id.name); },
    VariableDeclarator(p) { if (p.node.id.type === 'Identifier') local.add(p.node.id.name); }
  });
  for (const name of ['nonnegativeMoney', 'isReadableSavedOrder', 'buildSavedOrder', 'buildReorderPlan', 'mergeReorderItems']) assert(!local.has(name), name);
});
