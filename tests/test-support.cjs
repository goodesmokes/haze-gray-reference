const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const repositoryRoot = path.join(__dirname, '..');
const indexPath = path.join(repositoryRoot, 'index.html');

function readIndexHtml() {
  return fs.readFileSync(indexPath, 'utf8');
}

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function extractInlineModule(html = readIndexHtml()) {
  const match = html.match(/<script type="text\/babel"[^>]*data-type="module"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Missing Babel-backed application module in index.html');
  return match[1];
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

module.exports = { repositoryRoot, indexPath, readIndexHtml, readRepositoryFile, extractInlineModule, parseModule, collectNamedNodes, nodeText, importNativeModule, traverse };
