const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, nodeText } = require('./test-support.cjs');

const source = extractInlineModule();
const nodes = collectNamedNodes(source, (name) => [
  'browserIsOnline', 'confirmedProfileAccess', 'clearProtectedDraft', 'HazeGrayReference'
].includes(name));

test('browser connectivity uses the initial hint and cleans up online/offline listeners', () => {
  const browserIsOnline = Function(`return ${nodeText(source, nodes, 'browserIsOnline')}`)();
  assert.equal(browserIsOnline({ onLine: true }), true);
  assert.equal(browserIsOnline({ onLine: false }), false);
  assert.equal(browserIsOnline(undefined), true);
  const root = nodeText(source, nodes, 'HazeGrayReference');
  assert.match(root, /useState\(browserIsOnline\)/);
  assert.match(root, /addEventListener\?\.\("online", updateConnectivity\)/);
  assert.match(root, /addEventListener\?\.\("offline", updateConnectivity\)/);
  assert.match(root, /removeEventListener\?\.\("online", updateConnectivity\)/);
  assert.match(root, /removeEventListener\?\.\("offline", updateConnectivity\)/);
});

test('only a server-confirmed active valid profile produces protected permissions', async () => {
  const policy = await importNativeModule('js/domain/authorization.mjs');
  const confirmedProfileAccess = Function(
    'NO_PERMISSIONS', 'isActiveProfile', 'isValidRole', 'getProfilePermissions',
    `return ${nodeText(source, nodes, 'confirmedProfileAccess')}`
  )(policy.NO_PERMISSIONS, policy.isActiveProfile, policy.isValidRole, policy.getProfilePermissions);
  const profile = { role: 'owner', active: true };
  const snapshot = (metadata, data = profile) => ({ metadata, exists: () => data !== null, data: () => data });
  for (const metadata of [
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true }
  ]) {
    const result = confirmedProfileAccess(snapshot(metadata));
    assert.equal(result.confirmed, false);
    assert.equal(result.permissions, policy.NO_PERMISSIONS);
  }
  const confirmed = confirmedProfileAccess(snapshot({ fromCache: false, hasPendingWrites: false }));
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.permissions.canEditCatalog, true);
  for (const data of [null, { role: 'owner', active: false }, { role: 'invalid', active: true }]) {
    const result = confirmedProfileAccess(snapshot({ fromCache: false, hasPendingWrites: false }, data));
    assert.equal(result.confirmed, true);
    assert.equal(result.permissions, policy.NO_PERMISSIONS);
  }
});

test('offline and unconfirmed authorization clear protected memory without deleting the stored UID draft', () => {
  const root = nodeText(source, nodes, 'HazeGrayReference');
  assert.match(root, /const isAuthorizedUser = Boolean\(browserOnline && user/);
  assert.match(root, /if \(browserOnlineRef\.current && access\.uid/);
  const clear = nodeText(source, nodes, 'clearProtectedDraft');
  assert.match(root, /if \(!browserOnline\) \{[\s\S]*?setAuthorizationStatus\("unavailable"\)/);
  assert.match(root, /accessRef\.current = \{ uid: uid \|\| null, profile: null, permissions: NO_PERMISSIONS \}/);
  assert.match(root, /clearProtectedDraft\(\)/);
  assert.match(clear, /draftOwnerRef\.current = null/);
  assert.match(clear, /setOrderItems\(\[\]\)/);
  assert.match(clear, /setShowOrderBuilder\(false\); setShowFinalReview\(false\); setShowOrderHistory\(false\)/);
  assert.doesNotMatch(clear, /localStorage\.(?:removeItem|clear)/);
  assert.match(root, /authorizationStatus === "confirmed"/);
  assert.match(root, /confirmedPermissions\.canUseOrderBuilder[\s\S]*?loadOrderDraft\(uid\)/);
});

test('connectivity UI stays separate from the Phase 4D catalog freshness state', () => {
  const root = nodeText(source, nodes, 'HazeGrayReference');
  assert.match(root, /Offline — the public catalog remains available\. Sign-in and protected tools require a connection\./);
  assert.match(root, /Connection restored — verifying protected access…/);
  assert.match(root, /Signed in, but protected access could not be verified\. Public catalog browsing remains available\./);
  assert.match(root, /Offline catalog\$\{catalogConfirmedAt/);
  assert.match(root, /<CatalogList\b/);
  assert.doesNotMatch(root, /!browserOnline[^\n]*<CatalogList/);
});

test('offline service guards reject before Firebase while leaving sign-out available', async () => {
  const [catalogModule, profileModule, retailerModule, orderModule] = await Promise.all([
    importNativeModule('js/services/catalog-service.mjs'),
    importNativeModule('js/services/profile-service.mjs'),
    importNativeModule('js/services/retailer-service.mjs'),
    importNativeModule('js/services/order-service.mjs')
  ]);
  const calls = [];
  const common = {
    collection: (_db, ...parts) => ({ path: parts.join('/') }),
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    getDoc: async () => { calls.push('getDoc'); }, getDocs: async () => { calls.push('getDocs'); },
    setDoc: async () => { calls.push('setDoc'); }, deleteDoc: async () => { calls.push('deleteDoc'); },
    updateDoc: async () => { calls.push('updateDoc'); }, onSnapshot: () => { calls.push('onSnapshot'); return () => {}; },
    query: (value) => value, where: () => ({}), orderBy: () => ({}),
    runTransaction: async () => { calls.push('runTransaction'); }, serverTimestamp: () => ({})
  };
  const offline = () => false;
  const catalog = catalogModule.createCatalogService({}, common, offline);
  await assert.rejects(catalog.saveCatalogRecord({ id: 'cigar', imageUrl: '' }), /network connection/);
  assert.throws(() => catalog.deleteCatalogRecord('cigar'), /network connection/);
  await assert.rejects(catalog.readLegacyCatalog(), /network connection/);
  await assert.rejects(catalog.isLegacyCatalogMigrationAvailable(), /network connection/);

  const profile = profileModule.createProfileService({ db: {}, api: common, isOnline: offline });
  let profileUnavailable = false;
  profile.subscribeAuthorizedUsers(() => {}, () => {}, () => { profileUnavailable = true; });
  assert.equal(profileUnavailable, true);
  assert.throws(() => profile.readAuthorizationProfile('uid'), /network connection/);
  assert.throws(() => profile.updateAuthorizationProfile('uid', {}), /network connection/);

  const retailer = retailerModule.createRetailerService({ db: {}, auth: { currentUser: { uid: 'uid' } }, api: common, isOnline: offline });
  let retailerUnavailable = false;
  retailer.subscribeRetailerDirectory(true, () => {}, () => {}, () => { retailerUnavailable = true; });
  assert.equal(retailerUnavailable, true);
  await assert.rejects(retailer.saveRetailerProfile(null, {}, 'uid', () => true), /network connection/);
  await assert.rejects(retailer.saveRetailerAssignments('r', [], [], 'uid', () => true), /network connection/);

  const order = orderModule.createOrderService({ db: {}, auth: { currentUser: { uid: 'uid' } }, api: common, isOnline: offline });
  let historyUnavailable = false;
  order.subscribeOrderHistory({ allOrders: false, uid: 'uid' }, () => {}, () => {}, () => { historyUnavailable = true; });
  assert.equal(historyUnavailable, true);
  await assert.rejects(order.savePendingOrder({}, 'uid', () => true, [], []), /network connection/);
  assert.deepEqual(calls, []);
});

test('online events never invoke protected writes or pending-save retries', () => {
  const root = nodeText(source, nodes, 'HazeGrayReference');
  const connectivityEffect = root.slice(root.indexOf('const updateConnectivity'), root.indexOf('}, []);', root.indexOf('const updateConnectivity')) + 7);
  assert.doesNotMatch(connectivityEffect, /savePendingOrder|saveCatalogRecord|deleteCatalogRecord|saveAuthorizationProfile|saveRetailer/);
  assert.match(root, /if \(!browserOnline \|\| !canMigrateLegacyData\) return;[\s\S]*?isLegacyCatalogMigrationAvailable\(\)/);
});
