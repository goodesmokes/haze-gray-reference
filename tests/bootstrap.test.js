const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readIndexHtml, extractInlineModule, parseModule, importNativeModule, traverse } = require('./test-support.cjs');

test('index.html remains the application entry point with its React root and mount', () => {
  const html = readIndexHtml();
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="importmap">[\s\S]*?<\/script>/);
  assert.match(html, /<script type="text\/babel" data-type="module" data-presets="react">/);

  const source = extractInlineModule(html), ast = parseModule(source);
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
  assert(imports.some((node) => node.source.value === 'react'));
  assert(imports.some((node) => node.source.value === 'react-dom/client'));
  assert(imports.some((node) => node.source.value === './js/domain/pricing.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/authorization.mjs'));
  for (const module of ['./js/domain/retailers.mjs', './js/domain/assignments.mjs', './js/domain/territories.mjs']) assert(imports.some((node) => node.source.value === module), module);
  assert(imports.some((node) => node.source.value === './js/domain/saved-orders.mjs'));
  assert(imports.some((node) => node.source.value === './js/domain/catalog-data.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/firebase.mjs'));
  assert(imports.some((node) => node.source.value === './js/services/catalog-service.mjs'));

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

test('test support can directly import future native domain modules', async () => {
  const module = await importNativeModule('data:text/javascript,export const phase = 0;');
  assert.equal(module.phase, 0);
});
