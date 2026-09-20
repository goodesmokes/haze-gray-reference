const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule, extractInlineModule, parseModule, traverse } = require('./test-support.cjs');

let retailers, territories, assignments, authorization;
test.before(async () => {
  [retailers, territories, assignments, authorization] = await Promise.all([
    importNativeModule('js/domain/retailers.mjs'),
    importNativeModule('js/domain/territories.mjs'),
    importNativeModule('js/domain/assignments.mjs'),
    importNativeModule('js/domain/authorization.mjs')
  ]);
});

test('retailer module preserves validation, search, location and active duplicate behavior', () => {
  const blank = Object.fromEntries(Object.keys(retailers.RETAILER_FIELDS).map((key) => [key, '']));
  const input = { ...blank, name: '  Harbor Shop  ', contactName: ' Pat Smith ', email: ' sales@example.test ', phone: '5551234567', city: ' Esteli ', state: ' OK ', country: 'United States', active: true };
  const result = retailers.validateRetailer(input);
  assert.equal(result.name, 'Harbor Shop');
  assert.equal(result.nameNormalized, 'harbor shop');
  assert.equal(result.phone, '(555) 123-4567');
  assert.equal(retailers.retailerLocation(result), 'Esteli, OK');
  for (const query of ['harbor', 'PAT SMITH', 'Esteli,OK', ' esteli ,  ok ']) assert(retailers.retailerSearch(result, query), query);
  assert(!retailers.retailerSearch(result, 'Norfolk'));
  for (const invalid of [{ ...input, name: ' ' }, { ...input, email: 'bad email' }, { ...input, active: 'yes' }, { ...input, notes: 'x'.repeat(5001) }]) assert.throws(() => retailers.validateRetailer(invalid));
  const records = [{ ...result, id: 'active', active: true }, { ...result, id: 'inactive', active: false }];
  assert.equal(retailers.findDuplicateRetailer(records, ' HARBOR SHOP ').id, 'active');
  assert.equal(retailers.findDuplicateRetailer(records, 'Harbor Shop', 'active'), undefined);
  for (const id of ['a', 'x'.repeat(128)]) assert(retailers.validRetailerId(id));
  for (const id of [undefined, '', 'a/b', 'x'.repeat(129)]) assert(!retailers.validRetailerId(id));
});

test('retailer phone formatting remains country-aware and non-destructive', () => {
  for (const country of ['', 'United States', 'USA', 'US', ' us ']) assert.equal(retailers.formatRetailerPhone('+1 (555) 123-4567', country), '(555) 123-4567');
  for (const phone of ['+44 20 7946 0958', '555123456789', '555-123-4567 ext 2']) assert.equal(retailers.formatRetailerPhone(phone, ''), phone);
  assert.equal(retailers.formatRetailerPhone('020 7946 0958', 'United Kingdom'), '020 7946 0958');
});

test('United States remains an ordinary valid territory in labels, options and filters', () => {
  assert.equal(territories.territoryDisplay(' United States '), 'United States');
  assert.equal(territories.normalizeTerritory(' United   States '), 'united states');
  assert.deepEqual(territories.retailerTerritoryFields(' United States '), { territory: 'United States', territoryNormalized: 'united states' });
  assert.equal(territories.retailerTerritoryLabel({ territory: 'United States' }), 'United States');
  const records = [{ id: 'us', territory: 'United States' }, { id: 'west', territory: 'West' }, { id: 'none', territory: '' }];
  assert.deepEqual(territories.filterRetailerTerritories(records, 'mine', 'UNITED STATES').map((item) => item.id), ['us']);
  assert.deepEqual(territories.filterRetailerTerritories(records, 'territory:united states', '').map((item) => item.id), ['us']);
  const options = territories.retailerTerritoryOptions(records, [{ active: true, territory: 'UNITED STATES' }], { territory: 'United States' });
  assert(options.some((option) => option.value === 'united states' && option.label === 'United States'));
});

test('territory privacy and assignment filtering remain unchanged', () => {
  const records = [{ id: 'legacy' }, { id: 'mine', assignedRepUids: ['a', 'b'] }, { id: 'other', assignedRepUids: ['b'] }];
  assert.deepEqual(assignments.filterRetailerAssignments(records, 'mine', 'a').map((item) => item.id), ['mine']);
  assert.deepEqual(assignments.filterRetailerAssignments(records, 'assigned', 'a').map((item) => item.id), ['mine', 'other']);
  assert.deepEqual(assignments.filterRetailerAssignments(records, 'unassigned', 'a').map((item) => item.id), ['legacy']);
  assert.deepEqual(assignments.filterRetailerAssignments(records, 'rep:b', 'a').map((item) => item.id), ['mine', 'other']);
  const profiles = [{ uid: 'a', displayName: 'Alice', role: 'field_rep', active: true, territory: 'West' }];
  assert.deepEqual(territories.territoryMismatches({ territory: 'East', assignedRepUids: ['a'] }, profiles, false), []);
  assert.deepEqual(territories.territoryMismatches({ territory: 'East', assignedRepUids: ['a'] }, profiles, true), [{ uid: 'a', name: 'Alice', territory: 'West' }]);
  assert.equal(assignments.assignedRepLabel('a', 'a', false, profiles), 'You');
  assert.equal(assignments.assignedRepLabel('a', 'other', false, profiles), 'Other assigned user');
});

test('assignment eligibility continues to follow active Owner/Admin/Field Rep roles', () => {
  for (const role of ['owner', 'admin', 'field_rep']) assert(assignments.isAssignableRetailerUser({ role, active: true }));
  for (const profile of [{ role: 'viewer', active: true }, { role: 'field_rep', active: false }, { role: 'unknown', active: true }, null]) assert(!assignments.isAssignableRetailerUser(profile));
  for (const role of ['owner', 'admin']) assert(authorization.getProfilePermissions({ role, active: true }).canAssignRetailers);
  assert(!authorization.getProfilePermissions({ role: 'field_rep', active: true }).canAssignRetailers);
});

test('index imports retailer domain modules without duplicate local declarations', () => {
  const ast = parseModule(extractInlineModule()), local = new Set();
  traverse(ast, {
    FunctionDeclaration(p) { local.add(p.node.id.name); },
    VariableDeclarator(p) { if (p.node.id.type === 'Identifier') local.add(p.node.id.name); }
  });
  const extracted = ['RETAILER_FIELDS', 'RETAILER_AUTOCOMPLETE', 'normalizeRetailerName', 'retailerLocation', 'normalizeRetailerSearch', 'retailerSearch', 'validRetailerId', 'formatRetailerPhone', 'validateRetailer', 'findDuplicateRetailer', 'retailerAssignments', 'isAssignableRetailerUser', 'validateRepAssignments', 'assignedRepLabel', 'assignmentSummary', 'filterRetailerAssignments', 'territoryDisplay', 'normalizeTerritory', 'retailerTerritoryLabel', 'retailerTerritoryFields', 'retailerTerritoryOptions', 'filterRetailerTerritories', 'territoryMismatches'];
  for (const name of extracted) assert(!local.has(name), name);
});
