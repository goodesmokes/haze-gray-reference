const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { importNativeModule, collectNamedNodes, nodeText, readRepositoryFile } = require('./test-support.cjs');
const filenames = ['1982.webp', '1996.webp', 'admiral.webp', 'Backpack.webp', 'Brotherhood.webp', 'bussola.webp', 'HazeGray.webp', 'Irmaos_do_Mar.webp', 'Patriot.webp'];
const prefix = '/haze-gray-reference/assets/cigars/';
const invalid = ['data:image/jpeg;base64,abc', 'YWJjZA==', 'http://example.com/a.webp', 'https://example.com/a.webp', '/assets/cigars/a.webp', '/haze-gray-reference/assets/logo.webp', prefix + '../logo.webp', prefix + '%2e%2e.webp', prefix + 'a.webp?x=1', prefix + 'a.webp#x', prefix + 'a.webp\n', prefix + 'a/b.webp', prefix + '.webp', prefix + 'a.jpg', prefix + 'a'.repeat(240) + '.webp', null, 1, {}, []];

test('all current exact-case assets and future static paths are accepted', async () => {
  const { isValidCatalogImageUrl } = await importNativeModule('js/domain/catalog-images.mjs');
  const actual = fs.readdirSync(path.join(__dirname, '../assets/cigars'));
  for (const name of filenames) {
    assert(actual.includes(name), name);
    assert(isValidCatalogImageUrl(prefix + name), name);
  }
  for (const value of ['', undefined, prefix + 'future-cigar_2027.webp']) assert(isValidCatalogImageUrl(value));
  for (const value of invalid) assert.equal(isValidCatalogImageUrl(value), false, JSON.stringify(value));
});

test('shared catalog save rejects invalid images before any API write', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  const writes = [];
  const service = createCatalogService({}, { collection: () => ({}), doc: () => ({}), setDoc: async (_, value) => writes.push(value) });
  for (const imageUrl of invalid) await assert.rejects(service.saveCatalogRecord({ id: 'test', imageUrl }), /WebP/);
  assert.equal(writes.length, 0);
  for (const imageUrl of ['', ...filenames.map(name => prefix + name), prefix + 'future.webp']) await service.saveCatalogRecord({ id: 'test', imageUrl });
  await service.saveCatalogRecord({ id: 'no-photo' });
  assert.equal(writes.length, 12);
});

test('legacy import preflights every record before allowing any writes', async () => {
  const { createCatalogService } = await importNativeModule('js/services/catalog-service.mjs');
  const writes = [];
  let records;
  const service = createCatalogService({}, { collection: () => ({}), doc: () => ({}), setDoc: async (_, value) => writes.push(value), getDoc: async () => ({ exists: () => true, data: () => ({ payload: JSON.stringify(records) }) }) });
  const good = { id: 'good', imageUrl: prefix + '1982.webp' };
  for (const imageUrl of invalid) {
    records = [good, { id: 'bad', imageUrl }];
    await assert.rejects(async () => { for (const record of await service.readLegacyCatalog()) await service.saveCatalogRecord(record); }, /WebP/);
  }
  assert.equal(writes.length, 0, 'valid earlier records must not be partially imported');
  records = [good, { id: 'empty', imageUrl: '' }, { id: 'missing' }];
  assert.deepEqual(await service.readLegacyCatalog(), records);
  records = {};
  await assert.rejects(service.readLegacyCatalog(), /array/);
});


test('editor renders current paths and preview; invalid values disable saves and previews', async () => {
  const domain = await importNativeModule('js/domain/catalog-images.mjs');
  const source = readRepositoryFile('js/components/catalog-editor.mjs');
  const nodes = collectNamedNodes(source, name => name === 'CatalogEditor');
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const environment = { h, TextField: 'TextField', X: 'X', Cigarette: 'Cigarette', Plus: 'Plus', labelStyle: {}, inputStyle: {}, sizeInputStyle: {}, ...domain };
  const Editor = Function(...Object.keys(environment), 'return ' + nodeText(source, nodes, 'CatalogEditor'))(...Object.values(environment));
  const flatten = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(flatten) : [tree, ...tree.children.flatMap(flatten)];
  for (const imageUrl of [...filenames.map(name => prefix + name), '', ...invalid]) {
    const form = { name: 'Existing', imageUrl, sizes: [] };
    let changed;
    const tree = flatten(Editor({ form, editingId: 'existing', onFormChange: value => { changed = value; }, onSave: () => {} }));
    const input = tree.find(node => node.props.id === 'catalog-image-path');
    const save = tree.find(node => node.children.includes('Save Changes'));
    const preview = tree.find(node => node.type === 'img');
    assert.equal(input.props.value, imageUrl ?? '');
    assert.equal(save.props.disabled, !domain.isValidCatalogImageUrl(imageUrl));
    if (domain.isValidCatalogImageUrl(imageUrl) && imageUrl) assert.equal(preview.props.src, imageUrl);
    else assert.equal(preview, undefined);
    input.props.onChange({ target: { value: prefix + 'future.webp' } });
    assert.equal(changed.imageUrl, prefix + 'future.webp');
    assert.equal(changed.name, form.name);
  }
});
