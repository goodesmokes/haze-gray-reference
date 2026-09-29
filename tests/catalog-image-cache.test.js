const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectNamedNodes, importNativeModule, nodeText, readRepositoryFile, repositoryRoot } = require('./test-support.cjs');

class TestMessageChannel {
  constructor() {
    this.port1 = { onmessage: null, start() {}, close() {} };
    this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })) };
  }
}

function testImage() {
  const listeners = new Map();
  return {
    dataset: {}, style: {}, src: '',
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(value => value !== listener));
    },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    emit(type) { for (const listener of [...(listeners.get(type) || [])]) listener({ currentTarget: this }); }
  };
}

async function waitFor(check) {
  for (let count = 0; count < 20; count += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail('condition did not become true');
}

test('image message projection deduplicates exact approved paths and excludes everything else', async () => {
  const { catalogImagePaths } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const good = '/haze-gray-reference/assets/cigars/Future_2027.webp';
  assert.deepEqual(catalogImagePaths([
    { imageUrl: good }, { imageUrl: good }, { imageUrl: '' },
    { imageUrl: 'https://example.com/a.webp' }, { imageUrl: '/haze-gray-reference/assets/cigars/a.webp?x=1' },
    { imageUrl: '/haze-gray-reference/assets/private.webp' }
  ]), [good]);
});

test('cache synchronization waits for a correlated worker acknowledgement', async () => {
  const { requestCatalogImageCache, CATALOG_IMAGE_CACHE_MESSAGE, CATALOG_IMAGE_CACHE_RESULT_MESSAGE } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const messages = [];
  const worker = { postMessage(message, ports) {
    messages.push(message);
    ports[0].postMessage({
      type: CATALOG_IMAGE_CACHE_RESULT_MESSAGE, requestId: message.requestId,
      ok: true, reason: 'worker-ready', present: message.paths, missing: []
    });
  } };
  const serviceWorker = { ready: Promise.resolve({ active: worker }), controller: null };
  const records = [{ imageUrl: '/haze-gray-reference/assets/cigars/1982.webp', user: { uid: 'never-send' } }];
  const result = await requestCatalogImageCache(records, {
    authoritative: true, serviceWorker, MessageChannelCtor: TestMessageChannel, timeoutMs: 50
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.present, ['/haze-gray-reference/assets/cigars/1982.webp']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, CATALOG_IMAGE_CACHE_MESSAGE);
  assert.equal(messages[0].operation, 'synchronize');
  assert.equal(messages[0].authoritative, true);
  assert.deepEqual(messages[0].paths, ['/haze-gray-reference/assets/cigars/1982.webp']);
  assert.equal(Object.hasOwn(messages[0], 'user'), false);
  const empty = await requestCatalogImageCache([], {
    authoritative: true, serviceWorker, MessageChannelCtor: TestMessageChannel, timeoutMs: 50
  });
  assert.equal(empty.ok, true, 'an authoritative empty catalog can still clear obsolete public images');
  assert.deepEqual(messages[1].paths, []);
});

test('worker acknowledgement is bounded and a delayed controller can satisfy a probe', async () => {
  const { requestCatalogImageCachePaths, CATALOG_IMAGE_CACHE_RESULT_MESSAGE, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const path = '/haze-gray-reference/assets/cigars/Patriot.webp';
  const silentWorker = { postMessage() {} };
  const timedOut = await requestCatalogImageCachePaths([path], {
    serviceWorker: { ready: Promise.resolve({ active: silentWorker }), controller: silentWorker },
    MessageChannelCtor: TestMessageChannel, timeoutMs: 5
  });
  assert.equal(timedOut.reason, CATALOG_IMAGE_RECOVERY.WORKER_ACKNOWLEDGEMENT_TIMEOUT);

  const listeners = new Set();
  const worker = { postMessage(message, ports) {
    ports[0].postMessage({
      type: CATALOG_IMAGE_CACHE_RESULT_MESSAGE, requestId: message.requestId,
      ok: true, reason: 'worker-ready', present: [path], missing: []
    });
  } };
  const serviceWorker = {
    ready: Promise.resolve({ active: worker }), controller: null,
    addEventListener(type, listener) { if (type === 'controllerchange') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'controllerchange') listeners.delete(listener); }
  };
  setTimeout(() => {
    serviceWorker.controller = worker;
    for (const listener of listeners) listener();
  }, 0);
  const delayed = await requestCatalogImageCachePaths([path], {
    serviceWorker, MessageChannelCtor: TestMessageChannel, timeoutMs: 50
  });
  assert.equal(delayed.ok, true);
  assert.deepEqual(delayed.present, [path]);
  assert.equal(listeners.size, 0, 'controller listener is cleaned up');

  const noController = await requestCatalogImageCachePaths([path], {
    serviceWorker: { ready: Promise.resolve({ active: worker }), controller: null },
    MessageChannelCtor: TestMessageChannel, timeoutMs: 5
  });
  assert.equal(noController.reason, CATALOG_IMAGE_RECOVERY.NO_CONTROLLER);
});

test('all nine real case-sensitive WebPs remain approved and blob recovery revokes object URLs', async () => {
  const { catalogImagePaths, recoverCatalogImageFromCache, CATALOG_IMAGE_CACHE_NAME, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const names = ['1982.webp', '1996.webp', 'Backpack.webp', 'Brotherhood.webp', 'HazeGray.webp', 'Irmaos_do_Mar.webp', 'Patriot.webp', 'admiral.webp', 'bussola.webp'];
  const prefix = '/haze-gray-reference/assets/cigars/';
  const origin = 'https://goodesmokes.github.io';
  for (const name of names) assert(fs.existsSync(path.join(repositoryRoot, 'assets', 'cigars', name)));
  assert.deepEqual(catalogImagePaths(names.map(name => ({ imageUrl: prefix + name }))), names.map(name => prefix + name).sort());

  const entries = new Map(names.map(name => [origin + prefix + name, new Response(name, { headers: { 'content-type': 'image/webp' } })]));
  const matches = [];
  const cacheStorage = { open: async name => {
    assert.equal(name, CATALOG_IMAGE_CACHE_NAME);
    return { match: async (url, options) => { matches.push({ url, options }); return entries.get(url)?.clone(); } };
  } };
  const revoked = [];
  let objectNumber = 0;
  for (const name of names) {
    const image = testImage();
    const promise = recoverCatalogImageFromCache(image, prefix + name, {
      cacheStorage, origin, cacheRetryDelayMs: 0,
      createObjectURL: blob => { assert.equal(blob.type, 'image/webp'); return `blob:cached-${++objectNumber}`; },
      revokeObjectURL: url => revoked.push(url), imageLoadTimeoutMs: 50
    });
    await waitFor(() => image.src.startsWith('blob:cached-'));
    image.emit('load');
    const result = await promise;
    assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.RECOVERED_BLOB);
  }
  assert.equal(revoked.length, names.length);
  assert.equal(matches.length, names.length);
  assert(matches.every(({ options }) => options.ignoreVary === true));
});

test('transient Cache Storage failure is retried before the placeholder becomes terminal', async () => {
  const { handleCatalogImageError, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const path = '/haze-gray-reference/assets/cigars/1982.webp';
  let opens = 0;
  const image = testImage();
  const promise = handleCatalogImageError({ currentTarget: image }, path, {
    probeCatalogImageCache: async () => ({ ok: false, reason: CATALOG_IMAGE_RECOVERY.NO_CONTROLLER, present: [], missing: [path] }),
    cacheStorage: { open: async () => {
      opens += 1;
      if (opens === 1) throw new Error('storage process warming');
      return { match: async () => new Response('image', { headers: { 'content-type': 'image/webp' } }) };
    } },
    origin: 'https://goodesmokes.github.io', cacheRetryDelayMs: 0,
    createObjectURL: () => 'blob:retry-success', revokeObjectURL: () => {}, imageLoadTimeoutMs: 50
  });
  await waitFor(() => image.src === 'blob:retry-success');
  image.emit('load');
  const result = await promise;
  assert.equal(opens, 2);
  assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.RECOVERED_BLOB);
  assert.notEqual(image.style.display, 'none');
});

test('confirmed worker hit retries the normal URL once and recursive errors do not restart recovery', async () => {
  const { handleCatalogImageError, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const path = '/haze-gray-reference/assets/cigars/Irmaos_do_Mar.webp';
  const image = testImage();
  let probes = 0;
  const promise = handleCatalogImageError({ currentTarget: image }, path, {
    probeCatalogImageCache: async () => { probes += 1; return { ok: true, reason: 'worker-ready', present: [path], missing: [] }; },
    imageLoadTimeoutMs: 50
  });
  await waitFor(() => image.dataset.catalogImageRecoveryPhase === 'retrying');
  const recursive = await handleCatalogImageError({ currentTarget: image }, path, {});
  assert.equal(recursive.reason, CATALOG_IMAGE_RECOVERY.RECOVERY_IN_PROGRESS);
  image.emit('load');
  const result = await promise;
  assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.RECOVERED_NORMAL_URL);
  assert.equal(image.src, path);
  assert.equal(probes, 1);
});

test('failed normal retry falls through to blob recovery and decode failure becomes terminal', async () => {
  const { handleCatalogImageError, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const path = '/haze-gray-reference/assets/cigars/HazeGray.webp';
  const origin = 'https://goodesmokes.github.io';
  const revoked = [];
  const image = testImage();
  const promise = handleCatalogImageError({ currentTarget: image }, path, {
    probeCatalogImageCache: async () => ({ ok: true, reason: 'worker-ready', present: [path], missing: [] }),
    cacheStorage: { open: async () => ({ match: async () => new Response('image', { headers: { 'content-type': 'image/webp' } }) }) },
    origin, cacheRetryDelayMs: 0, createObjectURL: () => 'blob:fallback',
    revokeObjectURL: url => revoked.push(url), imageLoadTimeoutMs: 50
  });
  await waitFor(() => image.dataset.catalogImageRecoveryPhase === 'retrying');
  image.emit('error');
  await waitFor(() => image.src === 'blob:fallback');
  const recursive = await handleCatalogImageError({ currentTarget: image }, path, {});
  assert.equal(recursive.reason, CATALOG_IMAGE_RECOVERY.RECOVERY_IN_PROGRESS);
  image.emit('error');
  const result = await promise;
  assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.BLOB_LOAD_DECODE_FAILURE);
  assert.equal(image.dataset.catalogImageRecoveryPhase, 'terminal');
  assert.equal(image.style.display, 'none');
  assert.deepEqual(revoked, ['blob:fallback']);
});

test('invalid cached MIME is rejected with a diagnostic terminal reason', async () => {
  const { handleCatalogImageError, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const path = '/haze-gray-reference/assets/cigars/Patriot.webp';
  const image = testImage();
  const result = await handleCatalogImageError({ currentTarget: image }, path, {
    probeCatalogImageCache: async () => ({ ok: true, reason: 'worker-ready', present: [], missing: [path] }),
    cacheStorage: { open: async () => ({ match: async () => new Response('bad', { headers: { 'content-type': 'text/plain' } }) }) },
    origin: 'https://goodesmokes.github.io', cacheRetryDelayMs: 0, createObjectURL: () => 'never'
  });
  assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.INVALID_RESPONSE_MIME);
  assert.equal(image.dataset.catalogImageRecoveryReason, CATALOG_IMAGE_RECOVERY.INVALID_RESPONSE_MIME);
  assert.equal(image.style.display, 'none');
});

test('a stalled page Cache Storage operation is bounded before terminal fallback', async () => {
  const { handleCatalogImageError, CATALOG_IMAGE_RECOVERY } = await importNativeModule('js/services/catalog-image-cache.mjs');
  const imagePath = '/haze-gray-reference/assets/cigars/Backpack.webp';
  const image = testImage();
  const result = await handleCatalogImageError({ currentTarget: image }, imagePath, {
    probeCatalogImageCache: async () => ({ ok: false, reason: CATALOG_IMAGE_RECOVERY.WORKER_ACKNOWLEDGEMENT_TIMEOUT, present: [], missing: [imagePath] }),
    cacheStorage: { open: () => new Promise(() => {}) },
    origin: 'https://goodesmokes.github.io', createObjectURL: () => 'never',
    cacheAttempts: 1, cacheOperationTimeoutMs: 5, cacheRetryDelayMs: 0
  });
  assert.equal(result.reason, CATALOG_IMAGE_RECOVERY.CACHE_OPEN_FAILURE);
  assert.equal(result.probeReason, CATALOG_IMAGE_RECOVERY.WORKER_ACKNOWLEDGEMENT_TIMEOUT);
  assert.equal(image.dataset.catalogImageRecoveryPhase, 'terminal');
  assert.equal(image.style.display, 'none');
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
