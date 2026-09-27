const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readApplicationModule } = require('./test-support.cjs');

const source = readApplicationModule();

test('startup hydrates durable catalog immediately while Firestore refresh runs in parallel', () => {
  const load = source.indexOf('loadCatalogSnapshot().then');
  const subscribe = source.indexOf('const unsubscribe = subscribeCatalog');
  assert(load > 0 && subscribe > load);
  assert.match(source, /setCigars\(snapshot\.records\)[\s\S]*?setCatalogStatus\(listenerFailure \|\| globalThis\.navigator\?\.onLine === false \? "cached" : "updating"\)/);
  assert.match(source, /if \(!active\) return;\s*if \(!isTrustedCatalogEvent\(event\)\)/);
  assert.match(source, /event\?\.metadata\?\.fromCache === true && globalThis\.navigator\?\.onLine === false/);
});

test('network and storage failures preserve good data and expose honest catalog states', () => {
  assert.match(source, /setCatalogStatus\(durableSnapshot \|\| serverConfirmed \? "cached" : "unavailable"\)/);
  assert.match(source, /Could not store the offline catalog snapshot/);
  assert.match(source, /Offline catalog\$\{catalogConfirmedAt/);
  assert.match(source, /Catalog unavailable offline — connect once to prepare it\./);
  assert.match(source, /Updating catalog…/);
});

test('server confirmation updates public catalog without coupling it to auth or draft lifecycle', () => {
  assert.match(source, /snapshot = createCatalogSnapshot\(event\)/);
  assert.match(source, /await replaceCatalogSnapshot\(snapshot\)/);
  assert.match(source, /requestCatalogImageCache\(snapshot\.records, \{ authoritative: true \}\)/);
  assert.doesNotMatch(source, /(?:loadCatalogSnapshot|replaceCatalogSnapshot|requestCatalogImageCache)\([^\n]*(?:user|profile|retailer|orderItems|draft)/);
  assert.match(source, /const ORDER_DRAFT_STORAGE_KEY = "haze-gray-cigars\.order-draft\.v2\."/);
});
