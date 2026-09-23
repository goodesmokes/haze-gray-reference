const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./client-helpers.cjs');
const { collectNamedNodes, extractInlineModule, nodeText } = require('./test-support.cjs');

const source = extractInlineModule();
const names = ['HazeGrayReference', 'addToOrder', 'setOrderQty', 'removeOrderItem', 'clearOrder', 'selectOrderRetailer', 'openOrderBuilder', 'openFinalReview', 'openOrderFromCompare'];
const nodes = collectNamedNodes(source, (name) => names.includes(name));
const root = nodeText(source, nodes, 'HazeGrayReference');
const text = (name) => nodeText(source, nodes, name);
const builderStart = root.indexOf(') : showOrderBuilder && canUseOrderBuilder ? (');
assert(builderStart >= 0, 'Order Builder branch');
const builder = root.slice(builderStart);
const client = loadClient();
const compile = (name, environment) => Function(...Object.keys(environment), `return ${text(name)}`)(...Object.values(environment));

test('Order Builder preserves linked/manual retailer modes and controlled fields', () => {
  const retailer = { id: 'retailer-1', name: 'Linked Shop', email: 'shop@example.test', active: true };
  const state = { retailerId: 'old', name: 'Captured Name', email: 'captured@example.test', error: '' };
  const environment = {
    requirePermission: () => true,
    directory: { records: [retailer] },
    retailerOrderFields: client.retailerOrderFields,
    setRetailerId: (value) => { state.retailerId = value; },
    setOrderRetailer: (value) => { state.name = value; },
    setOrderEmail: (value) => { state.email = value; },
    setError: (value) => { state.error = value; }
  };
  const select = compile('selectOrderRetailer', environment);
  select('retailer-1');
  assert.deepEqual(state, { retailerId: 'retailer-1', name: 'Linked Shop', email: 'shop@example.test', error: '' });
  select('');
  assert.equal(state.retailerId, '');
  assert.equal(state.name, 'Linked Shop', 'manual mode preserves the captured name');
  assert.equal(state.email, 'shop@example.test', 'manual mode preserves the captured email');
  assert.match(builder, /<select aria-label="Order retailer" value=\{retailerId\} onChange=\{\(e\) => selectOrderRetailer\(e\.target\.value\)\}/);
  assert.match(builder, /One-time \/ Manual Retailer/);
  assert.match(builder, /Linked retailer unavailable/);
  assert.equal((builder.match(/disabled=\{Boolean\(retailerId\)\}/g) || []).length, 2);
  assert.match(builder, /Switch to manual entry to edit name\/email/);
  assert.match(builder, /directory\.error[\s\S]*?onClick=\{directory\.reload\}>Reload Retailers/);
});

test('Order Builder add-line behavior preserves identity, pricing and duplicate configuration merging', () => {
  let items = [];
  let compareOrderId = 'cigar-1';
  const environment = {
    requirePermission: () => true,
    PACK_OPTIONS: client.PACK_OPTIONS,
    getSinglePrice: client.getSinglePrice,
    getNumericPrice: client.getNumericPrice,
    setOrderItems: (update) => { items = update(items); },
    compareOrderId,
    setCompareOrderId: (value) => { compareOrderId = value; }
  };
  const add = compile('addToOrder', environment);
  const cigar = { id: 'cigar-1', name: 'Cigar One' };
  const size = { key: 'robusto', vitola: 'Robusto', dims: '50 x 5', pricing: { msrp: 13, box10: 65, box20: 125 } };
  assert.equal(add(cigar, size, 'box10', 2), true);
  assert.deepEqual(items[0], {
    lineKey: 'cigar-1__robusto__box10', cigarId: 'cigar-1', cigarName: 'Cigar One', vitola: 'Robusto', dims: '50 x 5', packKey: 'box10', packLabel: '10ct Box', unitPrice: 65, retailUnitValue: 130, qty: 2
  });
  assert.equal(compareOrderId, null);
  add(cigar, size, 'box10', 3);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 5);
  assert.equal(items[0].unitPrice, 65);
  add(cigar, size, 'box20', 1);
  assert.equal(items.length, 2);
  assert.equal(items[1].lineKey, 'cigar-1__robusto__box20');
  assert.equal(items[1].unitPrice, 125);
  assert.equal(items[1].retailUnitValue, 260);
});

test('Order Builder quantity, remove and clear handlers preserve exact state behavior', () => {
  let items = [{ lineKey: 'a', qty: 2 }, { lineKey: 'b', qty: 4 }];
  const state = { retailerId: 'r1', retailer: 'Shop', email: 'shop@example.test', notes: 'Keep me', compare: 'cigar' };
  let removedKey;
  const common = { requirePermission: () => true, setOrderItems: (update) => { items = update(items); } };
  const setQuantity = compile('setOrderQty', common);
  const remove = compile('removeOrderItem', common);
  setQuantity('a', 3);
  assert.equal(items[0].qty, 3);
  setQuantity('a', 0);
  assert.deepEqual(items, [{ lineKey: 'b', qty: 4 }]);
  remove('b');
  assert.deepEqual(items, []);
  const clear = compile('clearOrder', {
    requirePermission: () => true,
    localStorage: { removeItem: (key) => { removedKey = key; } },
    orderDraftKey: (uid) => `draft:${uid}`,
    draftOwnerRef: { current: 'user-1' },
    setRetailerId: (value) => { state.retailerId = value; },
    setOrderItems: (value) => { items = value; },
    setOrderRetailer: (value) => { state.retailer = value; },
    setOrderEmail: (value) => { state.email = value; },
    setOrderNotes: (value) => { state.notes = value; },
    setCompareOrderId: (value) => { state.compare = value; }
  });
  clear();
  assert.equal(removedKey, 'draft:user-1');
  assert.deepEqual(state, { retailerId: '', retailer: '', email: '', notes: '', compare: null });
  assert.deepEqual(items, []);
});

test('Order Builder preserves the saved-order 100-line boundary without adding a different UI cap', () => {
  assert.doesNotMatch(text('addToOrder'), /100|orderItems\.length/);
  const profile = { active: true, role: 'field_rep', displayName: 'Rep' };
  const base = { cigarId: 'cigar', cigarName: 'Cigar', vitola: 'Robusto', dims: '50 x 5', packKey: 'box10', packLabel: '10ct Box', unitPrice: 65, retailUnitValue: 130, qty: 1 };
  const lines = Array.from({ length: 100 }, (_, index) => ({ ...base, sizeKey: `size-${index}`, lineKey: `cigar__size-${index}__box10` }));
  const draft = (orderItems) => ({ orderItems, orderRetailer: 'Shop', orderEmail: '', orderNotes: '' });
  assert.equal(client.buildSavedOrder(draft(lines), { uid: 'rep' }, profile).lineItems.length, 100);
  assert.throws(() => client.buildSavedOrder(draft([...lines, { ...base, sizeKey: 'size-100', lineKey: 'cigar__size-100__box10' }]), { uid: 'rep' }, profile), /1 and 100/);
});

test('Order Builder navigation and comparison handoff remain wired to root callbacks', () => {
  assert.match(builder, /onClick=\{\(\) => setShowOrderBuilder\(false\)\}[\s\S]*?Back to list/);
  assert.match(builder, /onClick=\{openFinalReview\}[\s\S]*?Final Review/);
  assert.match(builder, /\{li\.cigarName\} — \{li\.vitola\}/);
  assert.doesNotMatch(builder, /setSelectedId\(li\.cigarId\)/, 'Order Builder currently has no catalog-item navigation action');
  const handoff = text('openOrderFromCompare');
  assert.match(handoff, /setCompareOrderId\(cigarId\)/);
  assert.match(handoff, /setShowCompare\(false\)/);
  assert.match(handoff, /setShowOrderBuilder\(true\)/);
  assert.match(handoff, /document\.getElementById\(`order-cigar-\$\{cigarId\}`\)/);
  assert.match(builder, /border: compareOrderId === c\.id/);
  assert.match(text('addToOrder'), /if \(compareOrderId === cigar\.id\) \{[\s\S]*?setCompareOrderId\(null\)/);
});

test('Order Builder draft identity, persistence and permission-loss cleanup remain root-owned', () => {
  for (const initializer of [
    'const draftOwnerRef = useRef(null)',
    'const [draftUid, setDraftUid] = useState(null)',
    'const [orderItems, setOrderItems] = useState([])',
    'const [orderRetailer, setOrderRetailer] = useState("")',
    'const [orderEmail, setOrderEmail] = useState("")',
    'const [orderNotes, setOrderNotes] = useState("")',
    'const activeDraft = { orderItems, orderRetailer, orderEmail, orderNotes, retailerId }'
  ]) assert(root.includes(initializer), initializer);
  assert.match(root, /localStorage\.setItem\(key, JSON\.stringify\(\{ orderItems, orderRetailer, orderEmail, orderNotes, retailerId \}\)\)/);
  assert.match(root, /\[draftUid, orderItems, orderRetailer, orderEmail, orderNotes, retailerId\]/);
  assert.match(root, /setRetailerId\(restored\.retailerId \|\| ""\)[\s\S]*?setOrderNotes\(restored\.orderNotes \|\| ""\)/);
  assert.match(text('openOrderBuilder'), /setShowFinalReview\(false\)[\s\S]*?setShowOrderBuilder\(true\)/);
  assert.match(root, /if \(!canUseOrderBuilder\) \{ setShowOrderBuilder\(false\); setCompareOrderId\(null\); \}/);
  assert.match(root, /if \(!accessRef\.current\.permissions\.canUseOrderBuilder\) clearProtectedDraft\(\)/);
  assert.match(builder, /showOrderBuilder && canUseOrderBuilder/);
});
