const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule, extractInlineModule, parseModule, traverse } = require('./test-support.cjs');

let policy;
test.before(async () => { policy = await importNativeModule('js/domain/authorization.mjs'); });

const permissionKeys = [
  'canEditCatalog', 'canEditPackages', 'canUseOrderBuilder', 'canUseFinalReview',
  'canManageUsers', 'canMigrateLegacyData', 'canManageOwners', 'canUseRetailers',
  'canChangeRetailerStatus', 'canAssignRetailers', 'canFilterOwnRetailers', 'canEditRetailerTerritory'
];
const permissions = (...enabled) => Object.fromEntries(permissionKeys.map((key) => [key, enabled.includes(key)]));

test('authorization module preserves the exact role and permission matrix', () => {
  assert.deepEqual(policy.ROLE_LABELS, { owner: 'Owner', admin: 'Admin', field_rep: 'Field Rep', viewer: 'Viewer' });
  assert.deepEqual(policy.NO_PERMISSIONS, permissions());
  assert.deepEqual(policy.ROLE_PERMISSIONS.owner, permissions(...permissionKeys));
  assert.deepEqual(policy.ROLE_PERMISSIONS.admin, permissions('canEditCatalog', 'canEditPackages', 'canUseOrderBuilder', 'canUseFinalReview', 'canManageUsers', 'canUseRetailers', 'canChangeRetailerStatus', 'canAssignRetailers', 'canFilterOwnRetailers', 'canEditRetailerTerritory'));
  assert.deepEqual(policy.ROLE_PERMISSIONS.field_rep, permissions('canUseOrderBuilder', 'canUseFinalReview', 'canUseRetailers', 'canFilterOwnRetailers'));
  assert.deepEqual(policy.ROLE_PERMISSIONS.viewer, permissions());
  assert.equal(policy.ROLE_PERMISSIONS.viewer, policy.NO_PERMISSIONS);
  assert(Object.isFrozen(policy.ROLE_LABELS));
  assert(Object.isFrozen(policy.NO_PERMISSIONS));
  assert(Object.isFrozen(policy.ROLE_PERMISSIONS));
  for (const value of Object.values(policy.ROLE_PERMISSIONS)) assert(Object.isFrozen(value));
});

test('authorization policy remains fail-closed for inactive, missing and invalid profiles', () => {
  for (const role of Object.keys(policy.ROLE_LABELS)) {
    assert(policy.isValidRole(role));
    assert(policy.isActiveProfile({ role, active: true }));
    assert.equal(policy.getProfilePermissions({ role, active: true }), policy.ROLE_PERMISSIONS[role]);
    assert(!policy.isActiveProfile({ role, active: false }));
    assert.equal(policy.getProfilePermissions({ role, active: false }), policy.NO_PERMISSIONS);
  }
  for (const profile of [undefined, null, {}, { role: 'owner' }, { role: 'unknown', active: true }, { role: null, active: true }, { role: 'owner', active: 1 }]) {
    assert(!policy.isActiveProfile(profile));
    assert.equal(policy.getProfilePermissions(profile), policy.NO_PERMISSIONS);
  }
  for (const role of [undefined, null, '', 'unknown', 'Owner', '__proto__']) assert(!policy.isValidRole(role));
});

test('owner management and Admin restrictions remain unchanged', () => {
  const owner = { role: 'owner', active: true }, admin = { role: 'admin', active: true };
  const fieldRep = { role: 'field_rep', active: true }, viewer = { role: 'viewer', active: true };
  assert.deepEqual(policy.getAssignableRoles(owner), ['owner', 'admin', 'field_rep', 'viewer']);
  assert.deepEqual(policy.getAssignableRoles(admin), ['admin', 'field_rep', 'viewer']);
  for (const manager of [fieldRep, viewer, null, { role: 'owner', active: false }]) assert.deepEqual(policy.getAssignableRoles(manager), []);
  for (const target of [owner, admin, fieldRep, viewer]) assert(policy.canManageAuthorizationProfile(owner, target));
  assert(!policy.canManageAuthorizationProfile(admin, owner));
  for (const target of [admin, fieldRep, viewer]) assert(policy.canManageAuthorizationProfile(admin, target));
  assert(!policy.canManageAuthorizationProfile(admin, null));
  assert(!policy.canManageAuthorizationProfile(viewer, fieldRep));
  assert.equal(policy.authorizationUpdateError(admin, 'admin-1', 'rep-1', fieldRep, { role: 'owner', active: true }), 'You are not authorized to assign this role.');
  assert.equal(policy.authorizationUpdateError(admin, 'admin-1', 'owner-1', owner, { role: 'owner', active: true }), 'You are not authorized to edit this authorization profile.');
});

test('self-role and self-active protections remain unchanged', () => {
  const owner = { role: 'owner', active: true };
  assert.equal(policy.authorizationUpdateError(owner, 'same', 'same', owner, { role: 'admin', active: true }), 'You cannot change your own authorization role.');
  assert.equal(policy.authorizationUpdateError(owner, 'same', 'same', owner, { role: 'owner', active: false }), 'You cannot disable your own authorization profile.');
  assert.equal(policy.authorizationUpdateError(owner, 'same', 'same', owner, { role: 'owner', active: true }), '');
  assert.equal(policy.authorizationUpdateError(owner, 'owner-1', 'owner-2', owner, { role: 'admin', active: false }), '');
  assert.equal(policy.authorizationUpdateError(null, 'same', 'same', owner, { role: 'owner', active: true }), 'You are not authorized to edit this authorization profile.');
});

test('index imports authorization and no longer declares extracted policy locally', () => {
  const ast = parseModule(extractInlineModule()), local = new Set();
  traverse(ast, {
    FunctionDeclaration(p) { local.add(p.node.id.name); },
    VariableDeclarator(p) { if (p.node.id.type === 'Identifier') local.add(p.node.id.name); }
  });
  for (const name of ['ROLE_LABELS', 'NO_PERMISSIONS', 'ROLE_PERMISSIONS', 'isValidRole', 'isActiveProfile', 'getProfilePermissions', 'getAssignableRoles', 'canManageAuthorizationProfile', 'authorizationUpdateError']) assert(!local.has(name), name);
});
