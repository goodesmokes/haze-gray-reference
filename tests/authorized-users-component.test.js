const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, parseModule, readApplicationModule, traverse } = require('./test-support.cjs');

const source = readApplicationModule();
const components = collectNamedNodes(source, (name) =>
  ['AuthorizationProfileEditor', 'AuthorizedUsers', 'HazeGrayReference'].includes(name)
);

function componentSource(name) {
  const node = components.get(name);
  assert(node, `${name} must remain declared in js/app.jsx`);
  return source.slice(node.start, node.end);
}

test('Authorized Users remains account-keyed so an identity change remounts and clears editing state', () => {
  const rootSource = componentSource('HazeGrayReference');
  const authorizedUsersSource = componentSource('AuthorizedUsers');

  assert.match(rootSource, /<AuthorizedUsers key=\{user\.uid\}/);
  assert.match(authorizedUsersSource, /const \[editingUid, setEditingUid\] = useState\(null\)/);
  assert.match(authorizedUsersSource, /\}, \[currentUid, requirePermission\]\);/);
});

test('Authorization Profile Editor remains target-keyed with target-derived and transient initial state', () => {
  const authorizedUsersSource = componentSource('AuthorizedUsers');
  const editorSource = componentSource('AuthorizationProfileEditor');

  assert.match(authorizedUsersSource, /<AuthorizationProfileEditor key=\{editingProfile\.uid\}/);
  assert.match(editorSource, /const \[role, setRole\] = useState\(profile\.role \|\| ""\)/);
  assert.match(editorSource, /const \[territory, setTerritory\] = useState\(profile\.territory \|\| ""\)/);
  assert.match(editorSource, /const \[active, setActive\] = useState\(profile\.active === true\)/);
  assert.match(editorSource, /const \[saving, setSaving\] = useState\(false\)/);
  assert.match(editorSource, /const \[saveError, setSaveError\] = useState\(""\)/);
  assert.match(editorSource, /setRole\(profile\.role \|\| ""\);\s*setTerritory\(profile\.territory \|\| ""\);\s*setActive\(profile\.active === true\);\s*\}, \[profile\.role, profile\.territory, profile\.active\]\);/);
});

test('a deleted or newly unmanageable target closes the editor with the existing error contract', () => {
  const authorizedUsersSource = componentSource('AuthorizedUsers');

  assert.match(authorizedUsersSource, /const editingProfile = profiles\.find\(\(p\) => p\.uid === editingUid\)/);
  assert.match(authorizedUsersSource, /if \(editingUid && !canManageAuthorizationProfile\(managerProfile, editingProfile\)\) \{\s*setEditingUid\(null\);\s*setUsersError\("You are no longer authorized to edit this authorization profile, or it no longer exists\."\);\s*\}/);
  assert.match(authorizedUsersSource, /\}, \[editingUid, editingProfile, managerProfile\]\);/);
});

test('authorized-user subscription cleanup suppresses late success and error callbacks', () => {
  const authorizedUsersSource = componentSource('AuthorizedUsers');

  assert.match(authorizedUsersSource, /let listening = true/);
  assert.equal((authorizedUsersSource.match(/if \(!listening\) return/g) || []).length, 2);
  assert.match(authorizedUsersSource, /return \(\) => \{ listening = false; unsubscribe\(\); \}/);

  const events = [];
  let listening = true;
  const receive = (kind) => { if (!listening) return; events.push(kind); };
  receive('success');
  listening = false;
  receive('late-success');
  receive('late-error');
  assert.deepEqual(events, ['success']);
});

test('Authorized Users preserves Owner/Admin target gates and protected self controls', () => {
  const authorizedUsersSource = componentSource('AuthorizedUsers');
  const editorSource = componentSource('AuthorizationProfileEditor');

  assert.match(authorizedUsersSource, /!requirePermission\("canManageUsers"\) \|\| !canManageAuthorizationProfile\(managerProfile, profile\) \|\|\s*\(profile\.role === "owner" && !requirePermission\("canManageOwners"\)\)/);
  assert.match(authorizedUsersSource, /canManageAuthorizationProfile\(managerProfile, profile\) && <button[\s\S]*?>Edit<\/button>/);
  assert.match(authorizedUsersSource, /canManageAuthorizationProfile\(managerProfile, editingProfile\) && <AuthorizationProfileEditor/);
  assert.match(editorSource, /const isSelf = profile\.uid === currentUid/);
  assert.match(editorSource, /aria-label="Authorization role"[\s\S]*?disabled=\{saving \|\| isSelf\}/);
  assert.match(editorSource, /aria-label="Authorization status"[\s\S]*?disabled=\{saving \|\| isSelf\}/);
  assert.match(editorSource, /You cannot change your own role or disable your own profile\./);
  assert.match(editorSource, /authorizationUpdateError\(managerProfile, currentUid, profile\.uid, profile, \{ role, active \}\)/);
});

test('Authorized Users components have not been extracted during test preparation', () => {
  const declarations = [];
  traverse(parseModule(source), {
    FunctionDeclaration(path) {
      if (['AuthorizationProfileEditor', 'AuthorizedUsers'].includes(path.node.id?.name)) declarations.push(path.node.id.name);
    }
  });
  assert.deepEqual(declarations, ['AuthorizationProfileEditor', 'AuthorizedUsers']);
});
