const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, importNativeModule, parseModule, readRepositoryFile } = require('./test-support.cjs');

let ui, styles;
test.before(async () => {
  const reactStub = 'data:text/javascript,' + encodeURIComponent('export default { createElement(type, props, ...children) { return { type, props: { ...(props || {}), children: children.length > 1 ? children : children[0] } }; } };');
  const retailerStub = 'data:text/javascript,' + encodeURIComponent('export const retailerLocation = (retailer) => [retailer.city, retailer.state].map((value) => (value || "").trim().replace(/\\s+/g, " ")).filter(Boolean).join(", ");');
  const source = readRepositoryFile('js/components/common-ui.mjs')
    .replace('"react"', JSON.stringify(reactStub))
    .replace('"../domain/retailers.mjs"', JSON.stringify(retailerStub));
  ui = await importNativeModule('data:text/javascript,' + encodeURIComponent(source));
  styles = await importNativeModule('js/ui/styles.mjs');
});

test('shared UI style constants preserve every value', () => {
  assert.deepEqual(styles.userFieldStyle, {
    width: '100%', background: '#14161A', border: '1px solid #454b53', borderRadius: 4,
    padding: '8px 10px', color: '#EDE6D6', fontSize: 14
  });
  assert.deepEqual(styles.userButtonStyle, {
    background: 'none', border: '1px solid #6E7681', color: '#C9CFD6', borderRadius: 4,
    padding: '8px 14px', fontFamily: "'Oswald', sans-serif", fontSize: 13
  });
});

test('Tag preserves tone mapping, children, element type and styles', () => {
  const child = { content: 'wrapper note' };
  const steel = ui.Tag({ children: child });
  assert.equal(steel.type, 'span');
  assert.equal(steel.props.children, child);
  assert.deepEqual(steel.props.style, {
    display: 'inline-block', padding: '5px 12px', margin: '0 6px 6px 0',
    fontFamily: "'Oswald', sans-serif", fontSize: 12.5, letterSpacing: 0.5,
    background: 'rgba(110,118,129,0.18)', border: '1px solid #6E7681', color: '#C9CFD6', borderRadius: 3
  });
  const brass = ui.Tag({ children: 'cedar', tone: 'brass' });
  assert.equal(brass.props.children, 'cedar');
  assert.equal(brass.props.style.background, 'rgba(184,137,76,0.16)');
  assert.equal(brass.props.style.border, '1px solid #B8894C');
  assert.equal(brass.props.style.color, '#E7C79A');
});

test('gauge position preserves clamping, defaults and custom geometry', () => {
  for (const [input, expectedValue, expectedX] of [[undefined, 1, 25.68], [0, 1, 25.68], [6, 5, 94.32]]) {
    const position = ui.getGaugePosition(input);
    assert.equal(position.value, expectedValue);
    assert(Math.abs(position.x - expectedX) < 1e-10);
    assert(Math.abs(position.y - 62) < 1e-10);
  }
  const middle = ui.getGaugePosition(3);
  assert.equal(middle.value, 3);
  assert(Math.abs(middle.x - 60) < 1e-10);
  assert.equal(middle.y, 27.68);
  const custom = ui.getGaugePosition(3, 10, 20, 5);
  assert.equal(custom.value, 3);
  assert(Math.abs(custom.x - 10) < 1e-10);
  assert.equal(custom.y, 16.1);
});

test('Gauge preserves SVG structure, ticks, needle, value and label', () => {
  const gauge = ui.Gauge({ value: 8, label: 'Strength' });
  assert.equal(gauge.type, 'div');
  assert.deepEqual(gauge.props.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 });
  const [svg, value, label] = gauge.props.children;
  assert.equal(svg.type, 'svg');
  assert.deepEqual({ viewBox: svg.props.viewBox, width: svg.props.width, height: svg.props.height }, { viewBox: '0 0 120 72', width: '120', height: '72' });
  const svgChildren = svg.props.children;
  assert.equal(svgChildren.length, 4);
  assert.equal(svgChildren[0].type, 'path');
  assert.equal(svgChildren[0].props.d, 'M 16 62 A 44 44 0 0 1 104 62');
  assert.equal(svgChildren[1].length, 5);
  assert(svgChildren[1].every((element) => element.type === 'line' && element.props.stroke === '#B8894C'));
  assert.equal(svgChildren[2].type, 'line');
  assert.equal(svgChildren[2].props.stroke, '#A8402E');
  assert.equal(svgChildren[3].type, 'circle');
  assert.equal(value.type, 'div');
  assert.equal(value.props.children, '5/5');
  assert.equal(label.props.children, 'Strength');
  assert.equal(label.props.style.textTransform, 'uppercase');
});

test('RetailerLocation preserves complete, partial and missing location rendering', () => {
  const complete = ui.RetailerLocation({ retailer: { city: ' San   Diego ', state: ' CA ' } });
  assert.equal(complete.type, 'div');
  assert.equal(complete.props.children, 'San Diego, CA');
  assert.deepEqual(complete.props.style, { display: 'block', marginTop: 6, color: '#C9CFD6', whiteSpace: 'normal', overflowWrap: 'anywhere' });
  assert.equal(ui.RetailerLocation({ retailer: { city: 'Austin', state: '' } }).props.children, 'Austin');
  assert.equal(ui.RetailerLocation({ retailer: { city: '', state: 'TX' } }).props.children, 'TX');
  for (const retailer of [{}, { city: '', state: '' }, { city: '  ', state: '  ' }]) assert.equal(ui.RetailerLocation({ retailer }), null);
});

test('app imports shared UI modules without duplicate local declarations', () => {
  const source = extractInlineModule();
  const ast = parseModule(source);
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
  const styleImport = imports.find((node) => node.source.value === './js/ui/styles.mjs');
  const componentImport = imports.find((node) => node.source.value === './js/components/common-ui.mjs');
  assert.deepEqual(styleImport.specifiers.map((node) => node.imported.name), ['userFieldStyle', 'userButtonStyle']);
  assert.deepEqual(componentImport.specifiers.map((node) => node.imported.name), ['Gauge', 'Tag', 'RetailerLocation']);
  const local = collectNamedNodes(source, (name) => ['userFieldStyle', 'userButtonStyle', 'getGaugePosition', 'Gauge', 'Tag', 'RetailerLocation'].includes(name));
  assert.deepEqual([...local.keys()], []);
});
