const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./client-helpers.cjs');
const { collectNamedNodes, parseModule, readApplicationModule, traverse } = require('./test-support.cjs');

const source = readApplicationModule();
const ast = parseModule(source);
const names = ['HazeGrayReference', 'RetailerDirectory', 'useRetailerDirectory', 'useAssignmentProfiles'];
const nodes = collectNamedNodes(source, (name) => names.includes(name));
const client = loadClient();

function declarationSource(name) {
  const node = nodes.get(name);
  assert(node, `${name} must remain declared in js/app.jsx`);
  return source.slice(node.start, node.end);
}

function variableExpression(componentName, variableName) {
  let expression;
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id?.name === variableName && path.getFunctionParent()?.node.id?.name === componentName) expression = path.node.init;
    }
  });
  assert(expression, `${componentName}.${variableName}`);
  return source.slice(expression.start, expression.end);
}

test('RetailerDirectory remains account-and-role keyed with fresh local UI state defaults', () => {
  const root = declarationSource('HazeGrayReference');
  const directory = declarationSource('RetailerDirectory');

  assert.match(root, /<RetailerDirectory key=\{`\$\{user\.uid\}:\$\{userProfile\.role\}`\}/);
  for (const expected of [
    'const [search, setSearch] = useState("")',
    'const [assignmentFilter, setAssignmentFilter] = useState("")',
    'const [territoryFilter, setTerritoryFilter] = useState("all")',
    'const [editingAssignments, setEditingAssignments] = useState(false)',
    'const [editor, setEditor] = useState(null)',
    'const [replace, setReplace] = useState(false)'
  ]) assert(directory.includes(expected), expected);
});

test('selection, direct target changes and active-status changes clear all transient editor state', () => {
  const directory = declarationSource('RetailerDirectory');

  assert.match(directory, /const selected = directory\.records\.find\(\(item\) => item\.id === selectedId\)/);
  assert.match(directory, /useEffect\(\(\) => \{ setEditor\(null\); setReplace\(false\); setEditingAssignments\(false\); \}, \[selectedId, selected\?\.active\]\)/);
  assert.match(directory, /const select = \(id\) => \{ if \(requirePermission\("canUseRetailers"\)\) \{ setEditor\(null\); onSelect\(id\); \} \}/);
  assert.match(directory, /onClose=\{\(\) => setEditor\(null\)\}/);
  assert.match(directory, /onClose=\{\(\) => setEditingAssignments\(false\)\}/);
  assert.match(directory, /onClick=\{\(\) => setReplace\(false\)\}>Cancel<\/button>/);
});

test('directory and assignment hooks preserve retry counters, scope resets and cleanup', () => {
  const directoryHook = declarationSource('useRetailerDirectory');
  const assignmentHook = declarationSource('useAssignmentProfiles');
  const directory = declarationSource('RetailerDirectory');

  for (const hook of [directoryHook, assignmentHook]) {
    assert.match(hook, /const \[retry, setRetry\] = useState\(0\)/);
    assert.match(hook, /\[scope, retry\]/);
    assert.match(hook, /reload: \(\) => setRetry\(\(value\) => value \+ 1\)/);
    assert.match(hook, /return \(\) => \{ live = false; stop\(\); \}/);
  }
  assert.match(directory, /directory\.error && <p role="alert">[\s\S]*?onClick=\{directory\.reload\}>Reload Retailers<\/button>/);
  assert.match(directory, /repDirectory\.error && <p role="alert">[\s\S]*?onClick=\{repDirectory\.reload\}>Retry<\/button>/);
});

test('assignment, territory and search filters preserve all existing combinations and empty states', () => {
  const directory = declarationSource('RetailerDirectory');
  const defaultFilter = Function('assignmentFilter', 'permissions', 'hasMine', `return ${variableExpression('RetailerDirectory', 'activeFilter')}`);
  const emptyState = Function('activeFilter', 'hasMine', `return ${variableExpression('RetailerDirectory', 'showMyRetailersEmptyState')}`);
  const records = [
    { id: 'mine', name: 'Harbor', city: 'Norfolk', active: true, territory: 'United States', assignedRepUids: ['rep'] },
    { id: 'assigned', name: 'Other', active: true, territory: 'West', assignedRepUids: ['other'] },
    { id: 'unassigned', name: 'Open', active: true, assignedRepUids: [] }
  ];

  assert.equal(defaultFilter('', { canFilterOwnRetailers: true, canAssignRetailers: false }, true), 'mine');
  assert.equal(defaultFilter('', { canFilterOwnRetailers: true, canAssignRetailers: false }, false), 'all');
  assert.equal(defaultFilter('assigned', { canFilterOwnRetailers: true }, false), 'assigned');
  assert.equal(emptyState('mine', false), true);
  for (const filter of ['all', 'assigned', 'unassigned', 'rep:other']) assert.equal(emptyState(filter, false), false);
  assert.deepEqual(client.filterRetailerAssignments(records, 'mine', 'rep').map((item) => item.id), ['mine']);
  assert.deepEqual(client.filterRetailerAssignments(records, 'assigned', 'rep').map((item) => item.id), ['mine', 'assigned']);
  assert.deepEqual(client.filterRetailerAssignments(records, 'unassigned', 'rep').map((item) => item.id), ['unassigned']);
  assert.deepEqual(client.filterRetailerTerritories(records, 'mine', 'United States').map((item) => item.id), ['mine']);
  assert(client.retailerSearch(records[0], 'norfolk'));
  assert.match(directory, /filterRetailerTerritories\(filterRetailerAssignments\(directory\.records, activeFilter, user\.uid\), territoryFilter, profile\?\.territory\)\.filter\(\(item\) => retailerSearch\(item, search\)\)/);
  assert.match(directory, /No retailers are currently assigned to you\./);
  assert.match(directory, /No retailers yet\./);
  assert.match(directory, /No retailers match your search\./);
});

test('role visibility and privacy gates remain fail-closed and manager mismatch details stay gated', () => {
  const directory = declarationSource('RetailerDirectory');
  const directoryHook = declarationSource('useRetailerDirectory');

  assert.match(directoryHook, /const manager = getProfilePermissions\(profile\)\.canChangeRetailerStatus/);
  assert.match(directoryHook, /subscribeRetailerDirectory\(manager,/);
  assert.match(directory, /useAssignmentProfiles\(user, permissions\.canAssignRetailers\)/);
  assert.match(directory, /permissions\.canAssignRetailers && repDirectory\.error/);
  assert.match(directory, /permissions\.canEditRetailerTerritory && mismatches\.length > 0/);
  assert.match(directory, /permissions\.canChangeRetailerStatus && <span> · \{item\.active \? "Active" : "Inactive"\}<\/span>/);
  assert.match(directory, /editor && \(!editor\.id \|\| \(selected && \(selected\.active \|\| permissions\.canChangeRetailerStatus\)\)\)/);
  assert.match(directory, /editingAssignments && selected && permissions\.canAssignRetailers/);

  const manager = client.getProfilePermissions({ role: 'owner', active: true });
  const rep = client.getProfilePermissions({ role: 'field_rep', active: true });
  assert(manager.canChangeRetailerStatus && manager.canAssignRetailers && manager.canEditRetailerTerritory);
  assert(!rep.canChangeRetailerStatus && !rep.canAssignRetailers && !rep.canEditRetailerTerritory);
});

test('RetailerDirectory preserves selection, order, history, edit, assignment and back callbacks', () => {
  const directory = declarationSource('RetailerDirectory');

  assert.match(directory, /onClick=\{selectedId \? \(\) => select\(null\) : onClose\}/);
  assert.match(directory, /onClick=\{\(\) => select\(item\.id\)\}/);
  assert.match(directory, /if \(hasMeaningfulDraft\(draft\)\) setReplace\(true\); else onStartOrder\(selected\.id\)/);
  assert.match(directory, /onStartOrder\(selected\.id, true\)/);
  assert.match(directory, /onHistory\(selected\.id\)/);
  assert.match(directory, /setEditor\(selected\)/);
  assert.match(directory, /setEditor\(\{\}\)/);
  assert.match(directory, /setEditingAssignments\(true\)/);
  assert.match(directory, /onSaved=\{select\} onOpenExisting=\{select\}/);
});

test('RetailerDirectory and its hooks remain local during Phase 7E-Prep', () => {
  for (const name of ['RetailerDirectory', 'useRetailerDirectory', 'useAssignmentProfiles']) assert(nodes.has(name), name);
});
