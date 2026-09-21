const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const repositoryRoot = path.join(__dirname, '..');
const indexPath = path.join(repositoryRoot, 'index.html');
const appPath = path.join(repositoryRoot, 'js', 'app.jsx');

function readIndexHtml() {
  return fs.readFileSync(indexPath, 'utf8');
}

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function readApplicationModule() {
  return fs.readFileSync(appPath, 'utf8');
}

// Retain the established helper name while source assertions transition to the external app entry.
function extractInlineModule() {
  return readApplicationModule();
}

function parseModule(source = extractInlineModule()) {
  return parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
}

function collectNamedNodes(source = extractInlineModule(), accept = () => true) {
  const nodes = new Map();
  traverse(parseModule(source), {
    FunctionDeclaration(nodePath) {
      const name = nodePath.node.id?.name;
      if (name && accept(name, nodePath)) nodes.set(name, nodePath.node);
    },
    VariableDeclarator(nodePath) {
      const name = nodePath.node.id?.name;
      if (name && accept(name, nodePath)) nodes.set(name, nodePath.node.init);
    }
  });
  return nodes;
}

function nodeText(source, nodes, name) {
  const node = nodes.get(name);
  if (!node) throw new Error(`Missing client declaration: ${name}`);
  return source.slice(node.start, node.end);
}

async function importNativeModule(specifier) {
  if (specifier instanceof URL) return import(specifier.href);
  if (/^(?:data|file|node):/.test(specifier)) return import(specifier);
  return import(pathToFileURL(path.resolve(repositoryRoot, specifier)).href);
}

module.exports = { repositoryRoot, indexPath, appPath, readIndexHtml, readApplicationModule, readRepositoryFile, extractInlineModule, parseModule, collectNamedNodes, nodeText, importNativeModule, traverse };
