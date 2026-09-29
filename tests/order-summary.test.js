const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, nodeText, readRepositoryFile } = require('./test-support.cjs');

const source = readRepositoryFile('js/app.jsx');
const names = new Set([
  'ORDER_SUMMARY_PRICING_DISCLAIMER',
  'buildOrderText',
  'emailOrder',
  'copyOrderText'
]);
const nodes = collectNamedNodes(source, (name) => names.has(name));
const disclaimer = Function(`return ${nodeText(source, nodes, 'ORDER_SUMMARY_PRICING_DISCLAIMER')}`)();

const orderItems = [{
  cigarName: '1982', vitola: 'Robusto', dims: '50 x 5', packLabel: '10ct Box',
  unitPrice: 25, retailUnitValue: 40, qty: 2
}];
const summaryState = {
  orderItems,
  orderRetailer: 'Harbor Shop',
  orderEmail: 'orders@example.test',
  orderNotes: 'Deliver Tuesday',
  orderWholesaleTotal: 50,
  orderRetailTotal: 80,
  orderGrossProfit: 30,
  orderMarginPct: 37.5,
  ORDER_SUMMARY_PRICING_DISCLAIMER: disclaimer
};

function compile(name, environment) {
  return Function(...Object.keys(environment), `return ${nodeText(source, nodes, name)}`)(...Object.values(environment));
}

function buildSummary() {
  return compile('buildOrderText', summaryState)();
}

test('shared order summary retains existing content and pricing with the disclaimer immediately after totals', () => {
  const summary = buildSummary();
  const expectedTotalsAndDisclaimer = [
    'ORDER TOTALS',
    'Wholesale: $50.00',
    'Retail Value: $80.00',
    'Gross Profit: $30.00',
    'Margin: 37.5%',
    '',
    disclaimer,
    '',
    'Notes: Deliver Tuesday'
  ].join('\n');

  assert(summary.startsWith([
    'HAZE GRAY CIGARS — RETAILER ORDER SUMMARY',
    '',
    'Retailer: Harbor Shop',
    'Contact: orders@example.test',
    '',
    '1982 — Robusto (50 x 5)',
    '10ct Box x2',
    'Wholesale: $50.00',
    'Retail Value: $80.00',
    'Gross Profit: $30.00',
    'Margin: 37.5%'
  ].join('\n')));
  assert(summary.endsWith(expectedTotalsAndDisclaimer));
  assert.equal(summary.split(disclaimer).length - 1, 1);
});

test('Email Summary contains the shared pricing disclaimer after its totals', () => {
  const buildOrderText = buildSummary;
  const windowValue = { location: { href: '' } };
  const emailOrder = compile('emailOrder', {
    requirePermission: () => true,
    orderItems,
    alert: () => assert.fail('non-empty order must not alert'),
    orderRetailer: summaryState.orderRetailer,
    orderEmail: summaryState.orderEmail,
    buildOrderText,
    window: windowValue,
    encodeURIComponent
  });

  emailOrder();
  const body = decodeURIComponent(windowValue.location.href.split('&body=')[1]);
  assert(body.includes(buildSummary()));
  assert(body.indexOf(disclaimer) > body.indexOf('Margin: 37.5%'));
});

test('Copy Summary contains the same pricing disclaimer after unchanged totals', async () => {
  let copied = '';
  const confirmations = [];
  const copyOrderText = compile('copyOrderText', {
    requirePermission: () => true,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    buildOrderText: buildSummary,
    setCopyConfirmed: (value) => confirmations.push(value),
    setTimeout: (callback) => callback()
  });

  await copyOrderText();
  assert.equal(copied, buildSummary());
  assert(copied.includes(`Margin: 37.5%\n\n${disclaimer}`));
  assert.deepEqual(confirmations, [true, false]);
});
