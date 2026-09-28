const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, importNativeModule, nodeText, readRepositoryFile } = require('./test-support.cjs');

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

test('offline recovery reads all cached WebPs while invalid cache entries keep the placeholder', async () => {
  const { recoverCatalogImageFromCache, handleCatalogImageError, CATALOG_IMAGE_CACHE_NAME } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const names = ['1982.webp', '1996.webp', 'Backpack.webp', 'Brotherhood.webp', 'HazeGray.webp', 'Irmaos_do_Mar.webp', 'Patriot.webp', 'admiral.webp', 'bussola.webp'];
  const prefix = '/haze-gray-reference/assets/cigars/';
  const origin = 'https://goodesmokes.github.io';
  const entries = new Map(names.map((name) => [origin + prefix + name, new Response(name, { headers: { 'content-type': 'image/webp' } })]));
  entries.set(origin + prefix + 'corrupt.webp', new Response('not an image', { headers: { 'content-type': 'text/plain' } }));
  const matches = [];
  const cacheStorage = {
    open: async (name) => {
      assert.equal(name, CATALOG_IMAGE_CACHE_NAME);
      return { match: async (url, options) => { matches.push({ url, options }); return entries.get(url)?.clone(); } };
    }
  };
  let objectNumber = 0;
  const recovered = [];
  const dependencies = {
    cacheStorage, origin,
    createObjectURL: (blob) => { assert.equal(blob.type, 'image/webp'); return `blob:cached-${++objectNumber}`; },
    revokeObjectURL: (url) => recovered.push(url)
  };
  const image = () => ({ dataset: {}, style: {}, src: '', listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } });

  for (const name of names) {
    const element = image();
    assert.equal(await recoverCatalogImageFromCache(element, prefix + name, dependencies), true);
    assert.match(element.src, /^blob:cached-/);
    element.listeners.load();
  }
  assert.equal(recovered.length, names.length);
  assert.equal(matches.length, names.length);
  assert(matches.every(({ options }) => options.ignoreVary === true));

  for (const path of [prefix + 'missing.webp', prefix + 'corrupt.webp', 'https://example.com/remote.webp']) {
    const element = image();
    await handleCatalogImageError({ currentTarget: element }, path, dependencies);
    assert.equal(element.style.display, 'none');
    assert.equal(element.src, '');
  }
  assert.equal(matches.length, names.length + 2, 'unapproved remote paths never reach Cache Storage');
});

test('catalog list and detail route failed image requests through the owned-cache recovery', () => {
  const calls = [];
  const handleCatalogImageError = (event, path) => calls.push({ event, path });
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const flatten = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(flatten) : [tree, ...(tree.children || []).flatMap(flatten)];
  const compile = (file, name, environment) => {
    const source = readRepositoryFile(file);
    const nodes = collectNamedNodes(source, (candidate) => candidate === name);
    return Function(...Object.keys(environment), `return ${nodeText(source, nodes, name)}`)(...Object.values(environment));
  };
  const cigar = { id: '1982', name: '1982', line: 'Core', imageUrl: '/haze-gray-reference/assets/cigars/1982.webp', wrapper: 'Habano', strength: 3, body: 3, sizes: [], tastingNotes: [], pairings: [] };
  const CatalogList = compile('js/components/catalog-list.mjs', 'CatalogList', { React: { Fragment: 'Fragment' }, ChevronRight: 'ChevronRight', Cigarette: 'Cigarette', Scale: 'Scale', Search: 'Search', h, handleCatalogImageError });
  const list = flatten(CatalogList({ cigars: [cigar], filtered: [cigar], groupedFiltered: [{ name: 'Core', items: [cigar] }], query: '', onQueryChange: () => {}, strengthFilter: 'all', onStrengthFilterChange: () => {}, sortBy: 'name', onSortChange: () => {}, compareMode: false, onToggleCompareMode: () => {}, compareIds: [], onSelectCigar: () => {}, onToggleCompareId: () => {}, onCompare: () => {}, strengthWord: () => 'Medium', sizeSummary: () => 'No sizes' }));
  const listImage = list.find((node) => node.type === 'img');
  const listEvent = { currentTarget: {} };
  listImage.props.onError(listEvent);

  const CigarDetail = compile('js/components/cigar-detail.mjs', 'CigarDetail', { ArrowLeft: 'ArrowLeft', Cigarette: 'Cigarette', Pencil: 'Pencil', Trash2: 'Trash2', Gauge: 'Gauge', Tag: 'Tag', h, marginDisplay: () => null, handleCatalogImageError });
  const detail = flatten(CigarDetail({ selected: cigar, canEditCatalog: false, user: null, orderControls: null, onBack: () => {}, onEdit: () => {}, onDelete: () => {} }));
  const detailImage = detail.find((node) => node.type === 'img');
  const detailEvent = { currentTarget: {} };
  detailImage.props.onError(detailEvent);

  assert.deepEqual(calls, [
    { event: listEvent, path: cigar.imageUrl },
    { event: detailEvent, path: cigar.imageUrl }
  ]);
});
