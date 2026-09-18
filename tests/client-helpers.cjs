const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
const names = ['ROLE_LABELS', 'NO_PERMISSIONS', 'ROLE_PERMISSIONS', 'isValidRole', 'isActiveProfile', 'getProfilePermissions', 'normalizeRetailerName', 'nonnegativeMoney', 'PACK_OPTIONS', 'SEED_CIGARS', 'parseMoney', 'getNumericPrice', 'getSinglePrice', 'buildSavedOrder', 'isReadableSavedOrder', 'buildReorderPlan', 'mergeReorderItems', 'savePendingOrder'];
const nodes = new Map();
traverse(ast, { FunctionDeclaration(p) { if (names.includes(p.node.id.name)) nodes.set(p.node.id.name, p.node); }, VariableDeclarator(p) { if (names.includes(p.node.id.name)) nodes.set(p.node.id.name, p.node.init); } });
exports.loadClient = (environment = {}) => {
  const code = names.map((name) => {
    const node = nodes.get(name); if (!node) throw new Error('Missing client helper: ' + name);
    const body = source.slice(node.start, node.end);
    return node.type === 'FunctionDeclaration' ? body : `const ${name} = ${body};`;
  }).join('\n');
  return Function(...Object.keys(environment), code + '\nreturn {' + names.join(',') + '};')(...Object.values(environment));
};
