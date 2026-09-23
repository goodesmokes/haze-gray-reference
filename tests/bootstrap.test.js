const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readIndexHtml, readApplicationModule, parseModule, importNativeModule, traverse } = require('./test-support.cjs');

test('index.html remains the application entry point with its React root and mount', () => {
  const html = readIndexHtml();
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="importmap">[\s\S]*?<\/script>/);
  const babelEntries = [...html.matchAll(/<script\b[^>]*type="text\/babel"[^>]*>[\s\S]*?<\/script>/g)];
  assert.equal(babelEntries.length, 1, 'exactly one Babel application entry');
  assert.match(babelEntries[0][0], /data-type="module"/);
  assert.match(babelEntries[0][0], /data-presets="react"/);
  assert.match(babelEntries[0][0], /src="\.\/js\/app\.jsx"/);
  assert.match(babelEntries[0][0], />\s*<\/script>$/, 'application code must not remain inline');

  const source = readApplicationModule(), ast = parseModule(source);
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
  assert(imports.some((node) => node.source.value === 'react'));
  assert(imports.some((node) => node.source.value === 'react-dom/client'));
  assert(imports.some((node) => node.source.value === './js/domain/pricing.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/authorization.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/retailers.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/saved-orders.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/catalog-data.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/firebase.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/catalog-service.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/retailer-service.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/profile-service.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/auth-service.mjs'));
  assert(imports.some((node) => node.source.value === './js/ui/styles.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/authorization-ui.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/retailer-directory.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/comparison-view.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/catalog-list.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/cigar-detail.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/order-history.mjs'));
  assert(imports.some((node) => node.source.value === './js/components/save-order-panel.mjs'));

  let rootLookup = false, appMount = false;
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name === 'rootEl' && p.node.init?.callee?.object?.name === 'document' && p.node.init?.callee?.property?.name === 'getElementById' && p.node.init.arguments[0]?.value === 'root') rootLookup = true;
    },
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === 'MemberExpression' && callee.property?.name === 'render' && callee.object?.type === 'CallExpression' && callee.object.callee?.name === 'createRoot' && callee.object.arguments[0]?.name === 'rootEl' && p.node.arguments[0]?.openingElement?.name?.name === 'HazeGrayReference') appMount = true;
    }
  });
  assert(rootLookup, 'root element lookup must remain present');
  assert(appMount, 'React application mount must remain present');
});

test('external app entry retains lifecycle guards and key-based remount boundaries', () => {
  const source = readApplicationModule();
  for (const expected of [
    'const draftOwnerRef = useRef(null)',
    'const accessRef = useRef({ uid: null, profile: null, permissions: NO_PERMISSIONS })',
    'let unsubscribeProfile = null',
    'let generation = 0',
    'const currentGeneration = ++generation',
    'if (currentGeneration !== generation) return',
    'return () => { generation++; unsub(); if (unsubscribeProfile) unsubscribeProfile();',
    'if (!canEditCatalog) { setFormOpen(false); setConfirmDeleteId(null); }',
    'if (!canUseOrderBuilder) { setShowOrderBuilder(false); setCompareOrderId(null); }',
    'if (!canUseFinalReview) setShowFinalReview(false);',
    'if (!canManageUsers) setShowAuthorizedUsers(false);',
    'key={`${user.uid}:${userProfile.role}`}',
    'key={`${user.uid}:${userProfile.role}:${historyRetailerId || "all"}`}',
    'key={user.uid}',
    'key={`${user.uid}:${userProfile.role}`} draft={activeDraft}',
    'key={selected.id} cigar={selected}'
  ]) assert(source.includes(expected), expected);
});

test('test support can directly import future native domain modules', async () => {
  const module = await importNativeModule('data:text/javascript,export const phase = 0;');
  assert.equal(module.phase, 0);
});
