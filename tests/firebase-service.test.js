const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule, readRepositoryFile, traverse } = require('./test-support.cjs');

const EXPECTED_CONFIG = {
  apiKey: 'AIzaSyDYzcHxcQNKUzoJWp4Jd2c67DAvc51N1Pk',
  authDomain: 'haze-gray-cigars.firebaseapp.com',
  projectId: 'haze-gray-cigars',
  storageBucket: 'haze-gray-cigars.firebasestorage.app',
  messagingSenderId: '691261212011',
  appId: '1:691261212011:web:34ad8434b4a1c6f1dbb82e'
};

test('Firebase service preserves configuration and singleton instances', async () => {
  const service = await importNativeModule('js/services/firebase.mjs');
  const repeatedImport = await importNativeModule('js/services/firebase.mjs');
  assert.deepEqual(service.firebaseConfig, EXPECTED_CONFIG);
  assert.equal(service.fbApp.options.projectId, EXPECTED_CONFIG.projectId);
  assert.equal(service.db.app, service.fbApp);
  assert.equal(service.auth.app, service.fbApp);
  assert.equal(repeatedImport.fbApp, service.fbApp);
  assert.equal(repeatedImport.db, service.db);
  assert.equal(repeatedImport.auth, service.auth);
});

test('Firebase service initializes each exported instance exactly once', () => {
  const source = readRepositoryFile('js/services/firebase.mjs');
  const ast = parseModule(source);
  const calls = { initializeApp: [], getFirestore: [], getAuth: [] };
  traverse(ast, {
    CallExpression(path) {
      const name = path.node.callee?.name;
      if (calls[name]) calls[name].push(path.node);
    }
  });
  for (const name of Object.keys(calls)) assert.equal(calls[name].length, 1, `${name} call count`);
  assert.equal(calls.initializeApp[0].arguments[0].name, 'firebaseConfig');
  assert.equal(calls.getFirestore[0].arguments[0].name, 'fbApp');
  assert.equal(calls.getAuth[0].arguments[0].name, 'fbApp');
});

test('index imports Firebase instances and retains catalog references locally', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const serviceImport = ast.program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === './js/services/firebase.mjs');
  assert(serviceImport, 'Firebase service import');
  assert.deepEqual(serviceImport.specifiers.map((node) => node.imported.name), ['db', 'auth']);

  const forbiddenCalls = [];
  traverse(ast, {
    CallExpression(path) {
      if (['initializeApp', 'getFirestore', 'getAuth'].includes(path.node.callee?.name)) forbiddenCalls.push(path.node.callee.name);
    }
  });
  assert.deepEqual(forbiddenCalls, []);

  const nodes = collectNamedNodes(source, (name) => ['firebaseConfig', 'fbApp', 'db', 'auth', 'CIGARS_COL', 'LEGACY_DOC'].includes(name));
  assert.equal(nodes.has('firebaseConfig'), false);
  assert.equal(nodes.has('fbApp'), false);
  assert.equal(nodes.has('db'), false);
  assert.equal(nodes.has('auth'), false);
  assert.equal(nodes.get('CIGARS_COL').callee.name, 'collection');
  assert.equal(nodes.get('CIGARS_COL').arguments[0].name, 'db');
  assert.equal(nodes.get('CIGARS_COL').arguments[1].value, 'cigars');
  assert.equal(nodes.get('LEGACY_DOC').callee.name, 'doc');
  assert.equal(nodes.get('LEGACY_DOC').arguments[0].name, 'db');
  assert.deepEqual(nodes.get('LEGACY_DOC').arguments.slice(1).map((node) => node.value), ['app-data', 'cigars']);
});
