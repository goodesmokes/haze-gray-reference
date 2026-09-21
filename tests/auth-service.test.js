const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule } = require('./test-support.cjs');

function createFixture() {
  const calls = [];
  let authCallback;
  let unsubscribed = false;
  const api = {
    signInWithEmailAndPassword: async (auth, email, password) => {
      calls.push({ operation: 'signIn', auth, email, password });
      return { user: { uid: 'signed-in' } };
    },
    signOut: async (auth) => {
      calls.push({ operation: 'signOut', auth });
    },
    onAuthStateChanged: (auth, callback) => {
      calls.push({ operation: 'subscribe', auth });
      authCallback = callback;
      return () => { unsubscribed = true; };
    }
  };
  return { api, calls, getAuthCallback: () => authCallback, wasUnsubscribed: () => unsubscribed };
}

test('sign-in trims email, preserves password, and returns the Firebase result', async () => {
  const { createAuthService } = await importNativeModule('js/services/auth-service.mjs');
  const fixture = createFixture();
  const authentication = { name: 'test-auth' };
  const password = '  unchanged password  ';
  const result = await createAuthService({ auth: authentication, api: fixture.api }).signInWithEmail('  User@Example.Test  ', password);

  assert.deepEqual(result, { user: { uid: 'signed-in' } });
  assert.deepEqual(fixture.calls, [{ operation: 'signIn', auth: authentication, email: 'User@Example.Test', password }]);
});

test('sign-in and sign-out failures propagate for the existing React handlers to catch', async () => {
  const { createAuthService } = await importNativeModule('js/services/auth-service.mjs');
  const signInFailure = new Error('bad credentials');
  const signOutFailure = new Error('network failure');
  const service = createAuthService({ auth: {}, api: {
    signInWithEmailAndPassword: async () => { throw signInFailure; },
    signOut: async () => { throw signOutFailure; },
    onAuthStateChanged: () => () => {}
  } });

  await assert.rejects(service.signInWithEmail('user@example.test', 'secret'), (error) => error === signInFailure);
  await assert.rejects(service.signOutUser(), (error) => error === signOutFailure);
});

test('sign-out targets the injected Auth instance', async () => {
  const { createAuthService } = await importNativeModule('js/services/auth-service.mjs');
  const fixture = createFixture();
  const authentication = { name: 'test-auth' };
  await createAuthService({ auth: authentication, api: fixture.api }).signOutUser();
  assert.deepEqual(fixture.calls, [{ operation: 'signOut', auth: authentication }]);
});

test('Auth-state subscription forwards callbacks and the Firebase unsubscribe function', async () => {
  const { createAuthService } = await importNativeModule('js/services/auth-service.mjs');
  const fixture = createFixture();
  const authentication = { name: 'test-auth' };
  const received = [];
  const unsubscribe = createAuthService({ auth: authentication, api: fixture.api }).subscribeAuthState((user) => received.push(user));

  assert.deepEqual(fixture.calls, [{ operation: 'subscribe', auth: authentication }]);
  const user = { uid: 'account-a' };
  fixture.getAuthCallback()(user);
  fixture.getAuthCallback()(null);
  assert.deepEqual(received, [user, null]);
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
  assert.equal(fixture.wasUnsubscribed(), true);
});

test('index imports Auth primitives while retaining lifecycle and UI error ownership', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/auth-service.mjs');
  assert(serviceImport, 'auth service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => node.imported.name), ['signInWithEmail', 'signOutUser', 'subscribeAuthState']);
  assert(!ast.program.body.some((node) => node.type === 'ImportDeclaration' && node.source.value === 'firebase/auth'));

  const nodes = collectNamedNodes(source, (name) => ['handleSignIn', 'handleSignOut'].includes(name));
  const signInSource = source.slice(nodes.get('handleSignIn').start, nodes.get('handleSignIn').end);
  const signOutSource = source.slice(nodes.get('handleSignOut').start, nodes.get('handleSignOut').end);
  assert.match(signInSource, /await signInWithEmail\(signInEmail, signInPassword\)/);
  assert.match(signInSource, /setSignInError\("Sign-in failed/);
  assert.match(signInSource, /setSignInEmail\(""\)/);
  assert.match(signInSource, /setSignInPassword\(""\)/);
  assert.match(signOutSource, /await signOutUser\(\)/);
  assert.match(signOutSource, /catch \(e\)/);

  assert.match(source, /let generation = 0/);
  assert.match(source, /const currentGeneration = \+\+generation/);
  assert.match(source, /if \(currentGeneration !== generation\) return/);
  assert.match(source, /return \(\) => \{ generation\+\+; unsub\(\); if \(unsubscribeProfile\) unsubscribeProfile\(\)/);
});
