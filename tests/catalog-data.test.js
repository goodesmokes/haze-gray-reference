const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule } = require('./test-support.cjs');

const EXPECTED_IDS = [
  '1982',
  '1996',
  'haze-gray-sugartip',
  'backpack-infused',
  'patriot',
  'admiral',
  'brotherhood',
  'irmaos-do-mar',
  'bussola'
];

test('catalog data preserves seed records and stable identifiers', async () => {
  const { SEED_CIGARS } = await importNativeModule('js/domain/catalog-data.mjs');
  assert.equal(SEED_CIGARS.length, 9);
  assert.deepEqual(SEED_CIGARS.map((cigar) => cigar.id), EXPECTED_IDS);
  for (const cigar of SEED_CIGARS) {
    for (const field of ['id', 'name', 'line', 'imageUrl', 'wrapper', 'binder', 'filler', 'origin', 'strength', 'body', 'tastingNotes', 'pairings', 'sizes', 'notes']) {
      assert(Object.hasOwn(cigar, field), `${cigar.id} is missing ${field}`);
    }
    assert(Array.isArray(cigar.tastingNotes), `${cigar.id} tasting notes`);
    assert(Array.isArray(cigar.pairings), `${cigar.id} pairings`);
    assert(cigar.sizes.length > 0, `${cigar.id} sizes`);
  }
  const hash = createHash('sha256').update(JSON.stringify(SEED_CIGARS)).digest('hex');
  assert.equal(hash, 'dcb01f9622412630b7e5e0cf7bcf5f51dbb6f4959d48676856b08e2ffa0afb44');
});

test('package options preserve their exact values and order', async () => {
  const { PACK_OPTIONS } = await importNativeModule('js/domain/catalog-data.mjs');
  assert.deepEqual(PACK_OPTIONS, [
    { key: 'single', label: 'Single (loose stick)' },
    { key: 'box10', label: '10ct Box' },
    { key: 'box20', label: '20ct Box' },
    { key: 'bundle20', label: '20ct Bundle' }
  ]);
});

test('catalog form and size defaults preserve their structures', async () => {
  const { EMPTY_FORM, newSizeRow } = await importNativeModule('js/domain/catalog-data.mjs');
  assert.deepEqual({ ...EMPTY_FORM, sizes: undefined }, {
    name: '', line: '', imageUrl: '', wrapper: '', binder: '', filler: '',
    origin: '', strength: 3, body: 3,
    tastingNotes: '', pairings: '', notes: '', sizes: undefined
  });
  assert.equal(EMPTY_FORM.sizes.length, 1);
  for (const size of [EMPTY_FORM.sizes[0], newSizeRow()]) {
    assert.match(size.key, /^s-\d+-[a-z0-9]{5}$/);
    assert.deepEqual({ ...size, key: undefined }, {
      key: undefined,
      vitola: '', dims: '', msrp: '',
      keystoneSingle: '', keystoneBox10: '', keystoneBox20: '', keystoneBundle20: ''
    });
  }
});

test('index imports catalog data without duplicate local declarations', () => {
  const source = extractInlineModule();
  const imports = parseModule(source).program.body.filter((node) => node.type === 'ImportDeclaration');
  const catalogImport = imports.find((node) => node.source.value === './js/domain/catalog-data.mjs');
  assert(catalogImport, 'catalog data module import');
  assert.deepEqual(catalogImport.specifiers.map((node) => node.imported.name), ['newSizeRow', 'SEED_CIGARS', 'EMPTY_FORM', 'PACK_OPTIONS']);

  const extracted = new Set(['newSizeRow', 'SEED_CIGARS', 'EMPTY_FORM', 'PACK_OPTIONS']);
  const localNodes = collectNamedNodes(source, (name, nodePath) => extracted.has(name) && !nodePath.findParent((parent) => parent.isImportDeclaration()));
  assert.deepEqual([...localNodes.keys()], []);
});
