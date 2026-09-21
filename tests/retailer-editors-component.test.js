const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./client-helpers.cjs');
const { collectNamedNodes, parseModule, readApplicationModule, traverse } = require('./test-support.cjs');

const source = readApplicationModule();
const ast = parseModule(source);
const names = ['RetailerPhoneInput', 'RepAssignmentChoices', 'RetailerAssignmentEditor', 'RetailerEditor', 'RetailerDirectory'];
const nodes = collectNamedNodes(source, (name) => names.includes(name));
const client = loadClient();

function componentSource(name) {
  const node = nodes.get(name);
  assert(node, `${name} must remain declared in js/app.jsx`);
  return source.slice(node.start, node.end);
}

function stateInitializer(componentName, stateName) {
  let initializer;
  traverse(ast, {
    CallExpression(path) {
      if (path.node.callee.name !== 'useState' || path.getFunctionParent()?.node.id?.name !== componentName) return;
      if (path.parentPath.node.id?.elements?.[0]?.name === stateName) initializer = path.node.arguments[0];
    }
  });
  assert(initializer, `${componentName}.${stateName} initializer`);
  return source.slice(initializer.start, initializer.end);
}

test('RetailerEditor initializes each edit target independently and preserves creation defaults', () => {
  const initializeForm = Function('retailer', 'RETAILER_FIELDS', 'formatRetailerPhone', `return (${stateInitializer('RetailerEditor', 'form')})()`);
  const initializeTerritory = Function('retailer', 'territoryDisplay', `return (${stateInitializer('RetailerEditor', 'territory')})()`);
  const retailerA = { id: 'a', name: 'Alpha', phone: '5551112222', country: 'US', active: false, territory: 'West' };
  const retailerB = { id: 'b', name: 'Bravo', phone: '5553334444', country: 'Canada', active: true, territory: 'United States' };

  const formA = initializeForm(retailerA, client.RETAILER_FIELDS, client.formatRetailerPhone);
  const formB = initializeForm(retailerB, client.RETAILER_FIELDS, client.formatRetailerPhone);
  assert.equal(formA.name, 'Alpha');
  assert.equal(formA.phone, '(555) 111-2222');
  assert.equal(formA.active, false);
  assert.equal(formB.name, 'Bravo');
  assert.equal(formB.phone, '5553334444');
  assert.equal(formB.active, true);
  assert.equal(initializeTerritory(retailerA, client.territoryDisplay), 'West');
  assert.equal(initializeTerritory(retailerB, client.territoryDisplay), 'United States');

  const creation = initializeForm(null, client.RETAILER_FIELDS, client.formatRetailerPhone);
  assert.deepEqual(creation, { ...Object.fromEntries(Object.keys(client.RETAILER_FIELDS).map((key) => [key, key === 'country' ? 'United States' : ''])), phone: '', active: true });
  assert.equal(initializeTerritory(null, client.territoryDisplay), '');
});

test('RetailerEditor preserves busy, mounted, duplicate and navigation behavior', () => {
  const editor = componentSource('RetailerEditor');

  assert.match(editor, /const mounted = useRef\(true\)/);
  assert.match(editor, /const busy = useRef\(false\)/);
  assert.match(editor, /useEffect\(\(\) => \(\) => \{ mounted\.current = false; \}, \[\]\)/);
  assert.match(editor, /if \(busy\.current \|\| !requirePermission\("canUseRetailers"\)\) return/);
  assert.match(editor, /busy\.current = true; setSaving\(true\); setError\(""\); setDuplicateId\(null\)/);
  assert.match(editor, /if \(mounted\.current && auth\.currentUser\?\.uid === currentUid && requirePermission\("canUseRetailers"\)\) onSaved\(id\)/);
  assert.match(editor, /if \(mounted\.current\) \{ setError\(failure\.message\); setDuplicateId\(failure\.retailerId \|\| null\); \}/);
  assert.match(editor, /finally \{ busy\.current = false; if \(mounted\.current\) setSaving\(false\); \}/);
  assert.match(editor, /duplicateId && <button type="button"[\s\S]*?onClick=\{\(\) => onOpenExisting\(duplicateId\)\}>Open Existing Retailer<\/button>/);
  assert.match(editor, /disabled=\{saving\}>\{saving \? "Saving…" : "Save Retailer"\}/);
});

test('phone input and RetailerEditor preserve formatting, cursor and autocomplete wiring', () => {
  const phone = componentSource('RetailerPhoneInput');
  const editor = componentSource('RetailerEditor');

  assert.match(phone, /"aria-label": "Phone", type: "tel", autoComplete: "tel", value, maxLength: 500, disabled/);
  assert.match(phone, /event\.target\.selectionStart !== next\.length/);
  assert.match(phone, /inputType\?\.startsWith\("delete"\)/);
  assert.match(phone, /event\.nativeEvent\?\.isComposing/);
  assert.match(phone, /onChange\(preserve \? next : formatRetailerPhone\(next, country\)\)/);
  assert.match(phone, /onBlur: \(event\) => onChange\(formatRetailerPhone\(event\.target\.value, country\)\)/);
  assert.match(editor, /<RetailerPhoneInput value=\{form\.phone\} country=\{form\.country\} disabled=\{saving\}/);
  assert.match(editor, /autoComplete=\{RETAILER_AUTOCOMPLETE\[key\]\}/);
});

test('RetailerEditor preserves territory initialization, options and role gates', () => {
  const editor = componentSource('RetailerEditor');

  assert.match(editor, /useState\(\(\) => territoryDisplay\(retailer\?\.territory\)\)/);
  assert.match(editor, /canEditTerritory \? <label[\s\S]*?aria-label="Retailer territory" autoComplete="off" list="retailer-territory-options"/);
  assert.match(editor, /territoryOptions\.map\(\(option\) => <option key=\{option\.value\} value=\{option\.label\} \/>\)/);
  assert.match(editor, /retailer \? retailerTerritoryLabel\(retailer\) : territoryDisplay\(homeTerritory\) \|\| "Unassigned Territory"/);
  assert.match(editor, /!retailer && " \(from your current user profile\)"/);
  assert.match(editor, /\.\.\.\(canEditTerritory \? \{ territory \} : \{\}\)/);
  assert.equal(client.territoryDisplay(' United States '), 'United States');
  assert.deepEqual(client.retailerTerritoryOptions([], [], { territory: 'United States' }), [{ value: 'united states', label: 'United States' }]);
});

test('RetailerAssignmentEditor snapshots each retailer and preserves busy/mounted handling', () => {
  const editor = componentSource('RetailerAssignmentEditor');
  const initializeExpected = Function('retailer', 'retailerAssignments', `return (${stateInitializer('RetailerAssignmentEditor', 'expected')})()`);
  const first = initializeExpected({ assignedRepUids: ['stale-a', 'rep-a'] }, client.retailerAssignments);
  const second = initializeExpected({ assignedRepUids: ['rep-b'] }, client.retailerAssignments);

  assert.deepEqual(first, ['stale-a', 'rep-a']);
  assert.deepEqual(second, ['rep-b']);
  assert.notEqual(first, second);
  assert.match(editor, /const \[value, setValue\] = useState\(expected\)/);
  assert.match(editor, /const busy = useRef\(false\), mounted = useRef\(true\)/);
  assert.match(editor, /useEffect\(\(\) => \(\) => \{ mounted\.current = false; \}, \[\]\)/);
  assert.match(editor, /if \(busy\.current\) return/);
  assert.match(editor, /saveRetailerAssignments\(retailer\.id, value, expected, user\.uid, requirePermission\)/);
  assert.match(editor, /if \(mounted\.current\) onClose\(\)/);
  assert.match(editor, /if \(mounted\.current\) setError\(failure\.message\)/);
  assert.match(editor, /finally \{ busy\.current = false; if \(mounted\.current\) setSaving\(false\); \}/);
});

test('assignment choices retain stale UIDs, gate additions by eligibility and preserve retry UI', () => {
  const choices = componentSource('RepAssignmentChoices');

  assert.match(choices, /repDirectory\.profiles\.filter\(\(profile\) => isAssignableRetailerUser\(profile\) \|\| value\.includes\(profile\.uid\)\)/);
  assert.match(choices, /const missing = value\.filter\(\(uid\) => !choices\.some\(\(profile\) => profile\.uid === uid\)\)/);
  assert.match(choices, /\[\.\.\.choices\.map\(\(profile\) => profile\.uid\), \.\.\.missing\]/);
  assert.match(choices, /disabled=\{!value\.includes\(uid\) && \(!repDirectory\.ready \|\| Boolean\(repDirectory\.error\) \|\| value\.length >= 10\)\}/);
  assert.match(choices, /event\.target\.checked \? \[\.\.\.value, uid\] : value\.filter\(\(id\) => id !== uid\)/);
  assert.match(choices, /repDirectory\.error && <p role="alert">\{repDirectory\.error\}[\s\S]*?onClick=\{repDirectory\.reload\}>Retry<\/button>/);
  assert.match(choices, /No active Owners, Admins, or Field Reps are available\./);
});

test('RetailerDirectory preserves conditional unmount/remount identity boundaries for both editors', () => {
  const directory = componentSource('RetailerDirectory');

  assert.match(directory, /useEffect\(\(\) => \{ setEditor\(null\); setReplace\(false\); setEditingAssignments\(false\); \}, \[selectedId, selected\?\.active\]\)/);
  assert.match(directory, /const select = \(id\) => \{ if \(requirePermission\("canUseRetailers"\)\) \{ setEditor\(null\); onSelect\(id\); \} \}/);
  assert.match(directory, /<RetailerEditor retailer=\{editor\.id \? editor : null\}[\s\S]*?onClose=\{\(\) => setEditor\(null\)\}/);
  assert.match(directory, /<RetailerAssignmentEditor retailer=\{selected\}[\s\S]*?onClose=\{\(\) => setEditingAssignments\(false\)\}/);
  assert.doesNotMatch(directory, /<Retailer(?:Assignment)?Editor key=/);
});

test('retailer editor components remain local during Phase 7D-Prep', () => {
  for (const name of names.slice(0, 4)) assert(nodes.has(name), name);
});
