const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, nodeText } = require('./test-support.cjs');

const source = extractInlineModule();
const nodes = collectNamedNodes(source, (name) => ['OrderHistory', 'HazeGrayReference'].includes(name));
const history = nodeText(source, nodes, 'OrderHistory');
const root = nodeText(source, nodes, 'HazeGrayReference');

test('Order History keeps its account, role and retailer-scope remount boundary with fresh local state', () => {
  assert.match(root, /<OrderHistory[\s\S]*?key=\{`\$\{user\.uid\}:\$\{userProfile\.role\}:\$\{historyRetailerId \|\| "all"\}`\}/);
  for (const initializer of [
    'const [orders, setOrders] = useState([])',
    'const [ready, setReady] = useState(false)',
    'const [historyError, setHistoryError] = useState("")',
    'const [search, setSearch] = useState("")',
    'const [selectedOrderId, setSelectedOrderId] = useState(null)',
    'const [review, setReview] = useState(false)',
    'const [acknowledged, setAcknowledged] = useState(false)',
    'const [retry, setRetry] = useState(0)'
  ]) assert(history.includes(initializer), initializer);
});

test('Order History preserves manager/creator subscription scope, cleanup and late-callback suppression', () => {
  assert.match(history, /const allOrders = getProfilePermissions\(profile\)\.canManageUsers/);
  assert.match(history, /subscribeOrderHistory\(\{ allOrders, uid: user\.uid \}, \(readable, malformedCount\) => \{/);
  assert.equal((history.match(/if \(!active\) return;/g) || []).length, 2, 'both success and error callbacks stay guarded');
  assert.match(history, /setHistoryError\(malformedCount \? "Some saved records contain malformed data and cannot be displayed\. The stored records have not been changed\." : ""\)/);
  assert.match(history, /setHistoryError\(`Could not load order history: \$\{e\.message\}`\)/);
  assert.match(history, /return \(\) => \{ active = false; stop\(\); \}/);
  assert.match(history, /\[user\.uid, allOrders, retry, requirePermission\]/);
});

test('Order History selection follows live snapshots and preserves close/reset behavior', () => {
  assert.match(history, /const selected = orders\.find\(\(order\) => order\.id === selectedOrderId\)/);
  const orders = [{ id: 'order-a' }];
  assert.equal(orders.find((order) => order.id === 'order-a')?.id, 'order-a');
  assert.equal([].find((order) => order.id === 'order-a'), undefined, 'a vanished order no longer renders as selected');
  assert.match(history, /!selected \? <>[\s\S]*?: <>[\s\S]*?<h2/);
  assert.match(history, /onClick=\{selected \? \(\) => \{ setSelectedOrderId\(null\); setReview\(false\); \} : onClose\}/);
  assert.match(history, /setOrders\(\[\]\); setSelectedOrderId\(null\); setReview\(false\); setReady\(true\)/);
  assert.match(history, /setSelectedOrderId\(order\.id\)/);
  assert.match(history, /onClick=\{\(\) => setReview\(false\)\}>Cancel/);
});

test('Order History preserves retailer/search filtering and linked-retailer navigation', async () => {
  const { normalizeRetailerName } = await importNativeModule('js/domain/retailers.mjs');
  const orders = [
    { id: 'a', retailerId: 'retailer-a', retailerName: 'Haze Shop', retailerNameNormalized: 'haze shop' },
    { id: 'b', retailerId: 'retailer-b', retailerName: 'Other Store' }
  ];
  const filter = (retailerFilter, search) => orders.filter((order) => (!retailerFilter || order.retailerId === retailerFilter)
    && (order.retailerNameNormalized || normalizeRetailerName(order.retailerName || '')).includes(normalizeRetailerName(search)));
  assert.deepEqual(filter(null, 'shop').map((order) => order.id), ['a']);
  assert.deepEqual(filter('retailer-b', 'other').map((order) => order.id), ['b']);
  assert.deepEqual(filter('retailer-a', 'other'), []);
  assert.match(history, /\(!retailerFilter \|\| order\.retailerId === retailerFilter\)/);
  assert.match(history, /normalizeRetailerName\(search\)/);
  assert.match(history, /Showing exact retailer-linked orders you are permitted to read\. Older unlinked orders are not included\./);
  assert.match(history, /validRetailerId\(selected\.retailerId\) && onOpenRetailer[\s\S]*?onOpenRetailer\(selected\.retailerId\)/);
  assert.match(root, /const openOrderHistory = \(filterId = null\) => \{[\s\S]*?setHistoryRetailerId\(typeof filterId === "string" \? filterId : null\)/);
  assert.match(root, /onClose=\{\(\) => \{ setShowOrderHistory\(false\); setShowCompare\(false\); setSelectedId\(null\); \}\}/);
});

test('reorder review preserves current-price planning, unavailable acknowledgement and signature resets', async () => {
  const { buildSavedOrder, buildReorderPlan } = await importNativeModule('js/domain/saved-orders.mjs');
  const savedLine = { lineKey: 'cigar__size__box10', cigarId: 'cigar', cigarName: 'Cigar', sizeKey: 'size', vitola: 'Robusto', dims: '50 x 5', packKey: 'box10', packLabel: '10ct Box', unitPrice: 60, retailUnitValue: 120, qty: 1 };
  const order = buildSavedOrder({ orderItems: [savedLine], orderRetailer: 'Shop', orderEmail: '', orderNotes: '' }, { uid: 'rep' }, { active: true, role: 'field_rep', displayName: 'Rep' });
  const packs = [{ key: 'box10', label: '10ct Box' }];
  const catalog = [{ id: 'cigar', name: 'Cigar', sizes: [{ key: 'size', vitola: 'Robusto', dims: '50 x 5', pricing: { box10: 65, msrp: 13 } }] }];
  const plan = buildReorderPlan(order, catalog, packs, [savedLine]);
  assert.equal(plan.available[0].historicalPrice, 60);
  assert.equal(plan.available[0].activePrice, 60);
  assert.equal(plan.available[0].line.unitPrice, 65);
  assert.equal(buildReorderPlan(order, [], packs, []).unavailable[0].reason, 'Product unavailable');
  assert.match(history, /const plan = selected \? buildReorderPlan\(selected, cigars, packOptions, draft\.orderItems\)/);
  assert.match(history, /const planSignature = JSON\.stringify\(plan\)/);
  assert.match(history, /useEffect\(\(\) => \{ setAcknowledged\(false\); \}, \[planSignature\]\)/);
  assert.match(history, /!plan\.available\.length \|\| \(plan\.unavailable\.length && !acknowledged\)/);
  assert.match(history, /I understand these items will not be added\./);
  assert.match(history, /disabled=\{!plan\.available\.length \|\| \(plan\.unavailable\.length > 0 && !acknowledged\)\}/);
});

test('reorder Add and Replace retain their reviewed-plan and draft callback contracts', () => {
  assert.match(history, /onApplyReorder\(selected, plan, mode\)/);
  assert.match(history, /onClick=\{\(\) => apply\("replace"\)\}/);
  assert.match(history, /onClick=\{\(\) => apply\("add"\)\}/);
  assert.match(root, /const applyReorder = \(order, reviewedPlan, mode\) => \{/);
  assert.match(root, /const currentPlan = buildReorderPlan\(order, cigars, PACK_OPTIONS, orderItems\)/);
  assert.match(root, /JSON\.stringify\(currentPlan\) !== JSON\.stringify\(reviewedPlan\)/);
  assert.match(root, /mergeReorderItems\(mode === "add" \? orderItems : \[\], currentPlan\.available\.map\(\(item\) => item\.line\)\)/);
  assert.match(root, /if \(mode === "replace"\) \{ setRetailerId\([\s\S]*?setOrderRetailer\([\s\S]*?setOrderEmail\([\s\S]*?setOrderNotes\(/);
  assert.match(root, /if \(access\.uid !== user\.uid \|\| \(!access\.permissions\.canManageUsers && order\.creatorUid !== access\.uid\)\)/);
});
