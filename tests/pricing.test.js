const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule, extractInlineModule, parseModule, traverse } = require('./test-support.cjs');

let pricing;
test.before(async () => { pricing = await importNativeModule('js/domain/pricing.mjs'); });

test('pricing module parses current and legacy price values without changing compatibility', () => {
  assert.equal(pricing.parseMoney('$1,234.56 suggested retail'), 1234.56);
  assert.equal(pricing.parseMoney('$0'), 0);
  for (const value of [undefined, null, '', '12.00', '$bad', {}]) assert.equal(pricing.parseMoney(value), null);

  const current = { pricing: { msrp: 12.4, box10: 64.5, box20: 120, bundle20: 100, boxSingle: 8, bundleSingle: 7 } };
  assert.equal(pricing.getNumericPrice(current, 'msrp'), 12.4);
  assert.equal(pricing.getNumericPrice(current, 'box10'), 64.5);
  assert.equal(pricing.getSinglePrice(current, 'box'), 8);
  assert.equal(pricing.getSinglePrice(current, 'bundle'), 7);

  const legacy = { msrp: '$12.40 MSRP', keystoneBox10: '$64.50', keystoneBox20: '$120.00', keystoneBundle20: '$100', keystoneSingle: '$8.00 box / $7.00 bundle' };
  assert.equal(pricing.getNumericPrice(legacy, 'msrp'), 12.4);
  assert.equal(pricing.getNumericPrice(legacy, 'box20'), 120);
  assert.equal(pricing.getSinglePrice(legacy, 'box'), 8);
  assert.equal(pricing.getSinglePrice(legacy, 'bundle'), 7);

  assert.equal(pricing.getNumericPrice({ pricing: { msrp: 0 }, msrp: '$12.40' }, 'msrp'), 0);
  assert.equal(pricing.getSinglePrice({ pricing: { boxSingle: 0 }, keystoneSingle: '$8 box' }, 'box'), 0);
  assert.equal(pricing.getNumericPrice({ pricing: { msrp: 'bad' }, msrp: '$12.40' }, 'msrp'), 12.4);
  for (const value of [{}, { pricing: {} }, { msrp: 'bad' }]) assert.equal(pricing.getNumericPrice(value, 'msrp'), null);
  assert.equal(pricing.getSinglePrice({ keystoneSingle: 'bad' }, 'box'), null);
  assert.equal(pricing.getSinglePrice(legacy, 'unknown'), null);
});

test('package margins preserve package eligibility and calculations', () => {
  const margins = pricing.computePackageMargins({ pricing: { msrp: 12.4, box10: 64.5, box20: 120, bundle20: 100 } });
  assert.deepEqual(margins.map(({ key, label, cost, retailValue }) => ({ key, label, cost, retailValue })), [
    { key: 'box10', label: '10ct Box', cost: 64.5, retailValue: 124 },
    { key: 'box20', label: '20ct Box', cost: 120, retailValue: 248 },
    { key: 'bundle20', label: '20ct Bundle', cost: 100, retailValue: 248 }
  ]);
  assert.equal(margins[0].grossProfit, 59.5);
  assert.equal(margins[0].marginPct, (59.5 / 124) * 100);
  assert.equal(margins[0].perStickCost, 6.45);
  assert.equal(margins[0].perStickProfit, 5.95);

  const legacy = pricing.computePackageMargins({ msrp: '$10', keystoneBox10: '$50', keystoneBox20: '$0', keystoneBundle20: 'bad' });
  assert.deepEqual(legacy.map((item) => item.key), ['box10']);
  for (const size of [{}, { pricing: { msrp: 0, box10: 50 } }, { msrp: 'bad', keystoneBox10: '$50' }, { pricing: { msrp: 10, box10: 0, box20: -1, bundle20: NaN } }]) assert.equal(pricing.computePackageMargins(size), null);
});

test('index imports pricing and no longer declares extracted pricing functions', () => {
  const ast = parseModule(extractInlineModule());
  const local = new Set();
  traverse(ast, { FunctionDeclaration(p) { local.add(p.node.id.name); } });
  for (const name of ['parseMoney', 'getNumericPrice', 'getSinglePrice', 'computePackageMargins']) assert(!local.has(name), name);
});
