const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, parseModule, readApplicationModule, readRepositoryFile, traverse } = require('./test-support.cjs');

const appSource = readApplicationModule();
const authorizationUiSource = readRepositoryFile('js/components/authorization-ui.mjs');
const appComponents = collectNamedNodes(appSource, (name) => name === 'HazeGrayReference');
const authorizationComponents = collectNamedNodes(authorizationUiSource, (name) =>
  ['AuthorizationProfileEditor', 'AuthorizedUsers'].includes(name)
);

function componentSource(name) {
  const isRoot = name === 'HazeGrayReference';
  const source = isRoot ? appSource : authorizationUiSource;
  const node = (isRoot ? appComponents : authorizationComponents).get(name);
  assert(node, `${name} must remain declared in its expected module`);
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

  assert.match(authorizedUsersSource, /h\(AuthorizationProfileEditor, \{ key: editingProfile\.uid,/);
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
  assert.match(authorizedUsersSource, /canManageAuthorizationProfile\(managerProfile, profile\) && h\("button",[\s\S]*?"Edit"\)/);
  assert.match(authorizedUsersSource, /canManageAuthorizationProfile\(managerProfile, editingProfile\) && h\(AuthorizationProfileEditor/);
  assert.match(editorSource, /const isSelf = profile\.uid === currentUid/);
  assert.match(editorSource, /"aria-label": "Authorization role"[\s\S]*?disabled: saving \|\| isSelf/);
  assert.match(editorSource, /"aria-label": "Authorization status"[\s\S]*?disabled: saving \|\| isSelf/);
  assert.match(editorSource, /You cannot change your own role or disable your own profile\./);
  assert.match(editorSource, /authorizationUpdateError\(managerProfile, currentUid, profile\.uid, profile, \{ role, active \}\)/);
});

test('app imports both exports and no duplicate local implementations remain', () => {
  const appAst = parseModule(appSource);
  const serviceImport = appAst.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/components/authorization-ui.mjs');
  assert(serviceImport, 'authorization UI import');
  assert.deepEqual(serviceImport.specifiers.map((node) => [node.imported.name, node.local.name]), [
    ['AuthorizationProfileEditor', 'AuthorizationProfileEditor'],
    ['AuthorizedUsers', 'AuthorizedUsers']
  ]);

  const localDeclarations = [];
  traverse(appAst, {
    FunctionDeclaration(path) {
      if (['AuthorizationProfileEditor', 'AuthorizedUsers'].includes(path.node.id?.name)) localDeclarations.push(path.node.id.name);
    }
  });
  assert.deepEqual(localDeclarations, []);

  const exported = [];
  traverse(parseModule(authorizationUiSource), {
    ExportNamedDeclaration(path) {
      const name = path.node.declaration?.id?.name;
      if (name) exported.push(name);
    }
  });
  assert.deepEqual(exported, ['AuthorizationProfileEditor', 'AuthorizedUsers']);
});
