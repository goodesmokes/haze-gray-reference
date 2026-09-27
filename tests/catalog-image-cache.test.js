const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule } = require('./test-support.cjs');

test('image message projection deduplicates exact approved paths and excludes everything else', async () => {
  const { catalogImagePaths } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const good = '/haze-gray-reference/assets/cigars/Future_2027.webp';
  assert.deepEqual(catalogImagePaths([
    { imageUrl: good }, { imageUrl: good }, { imageUrl: '' },
    { imageUrl: 'https://example.com/a.webp' }, { imageUrl: '/haze-gray-reference/assets/cigars/a.webp?x=1' },
    { imageUrl: '/haze-gray-reference/assets/private.webp' }
  ]), [good]);
});

test('cache requests are best-effort, account-independent and identify authoritative synchronization', async () => {
  const { requestCatalogImageCache, CATALOG_IMAGE_CACHE_MESSAGE } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const messages = [];
  const worker = { postMessage: message => messages.push(message) };
  const serviceWorker = { ready: Promise.resolve({ active: worker }), controller: null };
  const records = [{ imageUrl: '/haze-gray-reference/assets/cigars/1982.webp', user: { uid: 'never-send' } }];
  assert.equal(await requestCatalogImageCache(records, { authoritative: true, serviceWorker }), true);
  assert.deepEqual(messages, [{ type: CATALOG_IMAGE_CACHE_MESSAGE, authoritative: true, paths: ['/haze-gray-reference/assets/cigars/1982.webp'] }]);
  assert.equal(await requestCatalogImageCache(records, { serviceWorker: undefined }), false);
  assert.equal(await requestCatalogImageCache(records, { serviceWorker: { ready: Promise.reject(new Error('blocked')) } }), false);
});
