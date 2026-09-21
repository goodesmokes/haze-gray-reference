const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, importNativeModule, parseModule, readApplicationModule, readRepositoryFile, traverse } = require('./test-support.cjs');

const source = readApplicationModule();
const ast = parseModule(source);
const nodes = collectNamedNodes(source, (name) => ['HazeGrayReference', 'DetailOrderControls'].includes(name));
const rootNode = nodes.get('HazeGrayReference');
const root = source.slice(rootNode.start, rootNode.end);
const detailControls = source.slice(nodes.get('DetailOrderControls').start, nodes.get('DetailOrderControls').end);
const comparisonSource = readRepositoryFile('js/components/comparison-view.mjs');
const comparisonNodes = collectNamedNodes(comparisonSource, (name) => name === 'ComparisonView');
const comparison = comparisonSource.slice(comparisonNodes.get('ComparisonView').start, comparisonNodes.get('ComparisonView').end);
const catalogListSource = readRepositoryFile('js/components/catalog-list.mjs');
const catalogListNodes = collectNamedNodes(catalogListSource, (name) => name === 'CatalogList');
const catalogList = catalogListSource.slice(catalogListNodes.get('CatalogList').start, catalogListNodes.get('CatalogList').end);
const rootVariables = new Map();
traverse(ast, {
  VariableDeclarator(path) {
    if (path.getFunctionParent()?.node.id?.name === 'HazeGrayReference' && path.node.id.type === 'Identifier') rootVariables.set(path.node.id.name, path.node.init);
  }
});

function expression(name) {
  const node = rootVariables.get(name);
  assert(node, `missing ${name}`);
  return source.slice(node.start, node.end);
}

test('catalog search, strength filters, sort modes and result order remain executable', () => {
  const apply = Function('cigars', 'query', 'strengthFilter', 'sortBy', `return ${expression('filtered')}`);
  const cigars = [
    { id: 'z', name: 'Zulu', line: 'Bravo', wrapper: 'Maduro', strength: 5, body: 2, tastingNotes: ['Cocoa'], sizes: [{ vitola: 'Toro', dims: '6 x 52' }] },
    { id: 'a', name: 'Alpha', line: 'Alpha', wrapper: 'Connecticut', strength: 1, body: 5, tastingNotes: ['Cream'], sizes: [{ vitola: 'Robusto', dims: '5 x 50' }] },
    { id: 'm', name: 'Mike', line: '', wrapper: 'Habano', strength: 3, body: 3, tastingNotes: ['Pepper'], sizes: [] }
  ];
  assert.deepEqual(apply(cigars, '6 x 52', 'all', 'name').map((item) => item.id), ['z']);
  assert.deepEqual(apply(cigars, 'cocoa', 'all', 'name').map((item) => item.id), ['z']);
  assert.deepEqual(apply(cigars, '', '3', 'name').map((item) => item.id), ['m']);
  assert.deepEqual(apply(cigars, '', 'all', 'name').map((item) => item.id), ['a', 'm', 'z']);
  assert.deepEqual(apply(cigars, '', 'all', 'strength-asc').map((item) => item.id), ['a', 'm', 'z']);
  assert.deepEqual(apply(cigars, '', 'all', 'strength-desc').map((item) => item.id), ['z', 'm', 'a']);
  assert.deepEqual(apply(cigars, '', 'all', 'body-asc').map((item) => item.id), ['z', 'm', 'a']);
  assert.deepEqual(apply(cigars, '', 'all', 'body-desc').map((item) => item.id), ['a', 'm', 'z']);
});

test('catalog grouping preserves alphabetical line order, item counts and final Uncategorized placement', () => {
  const group = Function('filtered', `return ${expression('groupedFiltered')}`);
  const grouped = group([
    { id: 'u', line: '   ' },
    { id: 'b1', line: 'Bravo' },
    { id: 'a', line: 'Alpha' },
    { id: 'b2', line: 'Bravo' }
  ]);
  assert.deepEqual(grouped.map(({ name, items }) => [name, items.map((item) => item.id)]), [
    ['Alpha', ['a']],
    ['Bravo', ['b1', 'b2']],
    ['Uncategorized', ['u']]
  ]);
  assert.match(catalogList, /group\.items\.length/);
  assert.match(catalogList, /filtered\.length === 0[\s\S]*?No matches for that search\./);
});

test('catalog compare mode preserves click routing, three-item limit and compare button gates', () => {
  let update;
  const setCompareIds = (callback) => { update = callback; };
  const toggleCompareId = Function('setCompareIds', `return ${expression('toggleCompareId')}`)(setCompareIds);
  toggleCompareId('d');
  assert.deepEqual(update(['a', 'b', 'c']), ['b', 'c', 'd']);
  assert.deepEqual(update(['a', 'b']), ['a', 'b', 'd']);
  assert.deepEqual(update(['a', 'd']), ['a']);
  assert.match(catalogList, /onClick: \(\) => compareMode \? onToggleCompareId\(c\.id\) : onSelectCigar\(c\.id\)/);
  assert.match(catalogList, /const isChecked = compareIds\.includes\(c\.id\)/);
  assert.match(catalogList, /compareMode && compareIds\.length >= 2 && h\("div"/);
  assert.match(catalogList, /compareIds\.length, " cigars selected"/);
  assert.match(catalogList, /onClick: onCompare/);
  assert.match(catalogList, /compareMode \? "Cancel Compare" : "Compare"/);
  assert.match(root, /<CatalogList[\s\S]*?onToggleCompareId=\{toggleCompareId\}[\s\S]*?onCompare=\{\(\) => setShowCompare\(true\)\}/);
});

test('comparison preserves ID order, fallback values, pricing economics and callbacks', async () => {
  assert.match(root, /showCompare && compareIds\.length >= 2/);
  assert.match(root, /<ComparisonView compareIds=\{compareIds\} cigars=\{cigars\}[\s\S]*?onClose=\{\(\) => setShowCompare\(false\)\} onBuildOrder=\{openOrderFromCompare\}/);
  assert.match(comparison, /compareIds\.map\(\(id\) => \{\s*const c = cigars\.find\(\(x\) => x\.id === id\)/);
  assert.match(comparison, /onClick: onClose/);
  assert.match(comparison, /onClick: \(\) => onBuildOrder\(c\.id\)/);
  for (const fallback of ['c.wrapper || "—"', 'c.binder || "—"', 'c.filler || "—"', 'c.origin || "—"', 'if (!prices.length) return "—"', 'if (!allMargins.length) return "—"']) assert(comparison.includes(fallback), fallback);
  assert.match(comparison, /b\.marginPct > a\.marginPct \? b : a/);
  assert.match(comparison, /b\.grossProfit > a\.grossProfit \? b : a/);
  assert.match(comparison, /row\.label\.includes\("Margin"\) \|\| row\.label\.includes\("Profit"\) \? "#E7C79A"/);
  const pricing = await importNativeModule('js/domain/pricing.mjs');
  const margins = pricing.computePackageMargins({ msrp: '$10', keystoneBox10: '$60', keystoneBox20: '$110' });
  assert.deepEqual(margins.map(({ key, grossProfit, marginPct }) => [key, grossProfit, Number(marginPct.toFixed(1))]), [
    ['box10', 40, 40],
    ['box20', 90, 45]
  ]);
});

test('app imports the extracted comparison without retaining a duplicate implementation', () => {
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
  const comparisonImport = imports.find((node) => node.source.value === './js/components/comparison-view.mjs');
  assert.deepEqual(comparisonImport.specifiers.map((node) => node.imported.name), ['ComparisonView']);
  assert.deepEqual([...collectNamedNodes(source, (name) => name === 'ComparisonView').keys()], []);
  assert.deepEqual([...comparisonNodes.keys()], ['ComparisonView']);
  assert.match(comparisonSource, /export function ComparisonView/);
  assert.doesNotMatch(root, /Sales Comparison|Best Retail Margin|Best Box \/ Bundle Profit/);
});

test('app imports the extracted catalog list without retaining a duplicate implementation', () => {
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
  const catalogListImport = imports.find((node) => node.source.value === './js/components/catalog-list.mjs');
  assert.deepEqual(catalogListImport.specifiers.map((node) => node.imported.name), ['CatalogList']);
  assert.deepEqual([...collectNamedNodes(source, (name) => name === 'CatalogList').keys()], []);
  assert.deepEqual([...catalogListNodes.keys()], ['CatalogList']);
  assert.match(catalogListSource, /export function CatalogList/);
  assert.match(root, /<CatalogList cigars=\{cigars\} filtered=\{filtered\} groupedFiltered=\{groupedFiltered\}/);
  assert.doesNotMatch(root, /Search by name, wrapper, vitola, tasting note|No cigars logged yet|Sort: Strength/);
});

test('cigar detail preserves identity, fallbacks, display wiring and permission gates', () => {
  assert.match(root, /const selected = cigars\.find\(\(c\) => c\.id === selectedId\)/);
  assert.match(root, /selected\.imageUrl \? \([\s\S]*?<img src=\{selected\.imageUrl\} alt=\{selected\.name\}[\s\S]*?: \([\s\S]*?<Cigarette size=\{56\}/);
  assert.match(root, /<Gauge value=\{selected\.strength\} label="Strength" \/>/);
  assert.match(root, /<Gauge value=\{selected\.body\} label="Body" \/>/);
  assert.match(root, /<Tag key=\{i\} tone="brass">\{n\}<\/Tag>/);
  assert.match(root, /<Tag key=\{i\} tone="steel">\{n\}<\/Tag>/);
  assert.match(root, /No sizes on file\./);
  assert.match(root, /\{s\.msrp \|\| "—"\}/);
  assert.match(root, /\{s\.keystoneSingle \|\| "—"\}/);
  assert.match(root, /\{canEditCatalog \? \([\s\S]*?openEdit\(selected\)[\s\S]*?setConfirmDeleteId\(selected\.id\)/);
  assert.match(root, /\{canUseOrderBuilder && <DetailOrderControls/);
  assert.match(root, /onClick=\{\(\) => setSelectedId\(null\)\}[\s\S]*?Back to list/);
});

test('DetailOrderControls remains cigar-keyed and initializes fresh size, package and quantity state', () => {
  assert.match(root, /<DetailOrderControls key=\{selected\.id\} cigar=\{selected\}/);
  assert.match(detailControls, /const \[sizeKey, setSizeKey\] = useState\(""\)/);
  assert.match(detailControls, /const \[packKey, setPackKey\] = useState\(""\)/);
  assert.match(detailControls, /const \[quantity, setQuantity\] = useState\("1"\)/);
  assert.match(detailControls, /setSizeKey\(firstSize\?\.key \|\| ""\)/);
  assert.match(detailControls, /setPackKey\(firstSize \? packagesFor\(firstSize\)\[0\]\.key : ""\)/);
  assert.match(detailControls, /setQuantity\("1"\)/);
  assert.match(detailControls, /onAdd\(cigar, size, pack\.key, qty\)/);
});
