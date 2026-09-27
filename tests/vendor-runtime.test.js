const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const scope = '/haze-gray-reference/';

const artifacts = [
  ['Babel Standalone 7.24.7', 'vendor/babel/7.24.7/babel.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js', 'd9e33722fdfba37e4e428aa72cb58da65f18358bfb229e136dfc1285e76b03ff'],
  ['React 18.3.1', 'vendor/react/18.3.1/react.mjs', 'https://esm.sh/react@18.3.1/es2022/react.mjs', 'fec8d5ab4ffa55c8b563abc31060c3dc0205699aff20beec4aba0311efdcc1a0'],
  ['ReactDOM client 18.3.1', 'vendor/react-dom/18.3.1/client.mjs', 'https://esm.sh/react-dom@18.3.1/es2022/client.mjs', 'd68545ce29e9d2dd03261912eaf97e5f81469e9a9a7edcab3a91da6093d17606'],
  ['ReactDOM 18.3.1', 'vendor/react-dom/18.3.1/react-dom.mjs', 'https://esm.sh/react-dom@18.3.1/es2022/react-dom.mjs', '8d74245ed18f92dd4df0299b26a53dd6015f91beedf6cdef49463ba4e3063909'],
  ['Scheduler 0.23.2', 'vendor/scheduler/0.23.2/scheduler.mjs', 'https://esm.sh/scheduler@0.23.2/es2022/scheduler.mjs', '8a1a8a363eb417fc8d40f6b15132e8964320782d7169e68fc6ac98b8b8c201eb'],
  ['Lucide React 0.383.0', 'vendor/lucide-react/0.383.0/lucide-react.mjs', 'https://esm.sh/lucide-react@0.383.0/X-ZXJlYWN0/es2022/lucide-react.mjs', '0ec124976f559a85980bb276524e2444928a5f2afcbd7dadc7907102d12b95c1'],
  ['Firebase App 10.12.2', 'vendor/firebase/10.12.2/firebase-app.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js', '08b83f02859328aabb9acea9370d600ffe739d9e2c251b6668b6f6ff56a2e1d1'],
  ['Firebase Auth 10.12.2', 'vendor/firebase/10.12.2/firebase-auth.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js', '9b2ebba6ffced4657e12300f4187d53c8fc1762e98188e5e2005407a86e926b6'],
  ['Firebase Firestore 10.12.2', 'vendor/firebase/10.12.2/firebase-firestore.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js', 'aecb2b5b722d1a45426326cd144bc025d5bea8c48f3a53eca3914ad587361bd4']
];

function importMap() {
  const match = read('index.html').match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert(match, 'index.html must contain an import map');
  return JSON.parse(match[1]).imports;
}

async function shellInventory() {
  let install;
  vm.runInNewContext(read('sw.js'), {
    URL, Request,
    self: { location: { origin: 'https://goodesmokes.github.io' }, addEventListener: (name, handler) => { if (name === 'install') install = handler; } },
    caches: { open: async () => ({ addAll: async requests => { shellInventory.requests = requests; } }), delete: async () => true }
  });
  let pending;
  install({ waitUntil: promise => { pending = promise; } });
  await pending;
  return new Set(shellInventory.requests.map(request => new URL(request.url).pathname.slice(scope.length)));
}

function reachableLocalModules() {
  const queue = ['js/app.jsx'];
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'\"]*?\s+from\s*)?[\"']([^\"']+)[\"']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      // Babel emits app.jsx as document-relative code; native child modules
      // resolve relative imports from their own module URL.
      const base = file === 'js/app.jsx' ? '' : path.posix.dirname(file);
      const target = path.posix.normalize(path.posix.join(base, specifier));
      if (!seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

test('vendored runtime artifacts match documented sources and SHA-256 checksums', () => {
  const provenance = read('vendor/README.md');
  const notices = read('vendor/THIRD_PARTY_NOTICES.md');
  for (const [dependency, file, sourceUrl, expectedHash] of artifacts) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert(bytes.length > 0, file);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash, file);
    for (const value of [dependency, file.replace('vendor/', ''), sourceUrl, expectedHash]) assert(provenance.includes(value), value);
  }
  for (const license of ['MIT', 'ISC', 'Apache-2.0']) assert(notices.includes(license));
});

test('all executable startup imports resolve to exact local project resources', () => {
  const imports = importMap();
  assert.deepEqual(imports, {
    react: scope + 'vendor/react/18.3.1/react.mjs',
    'react-dom/client': scope + 'vendor/react-dom/18.3.1/client.mjs',
    'lucide-react': scope + 'vendor/lucide-react/0.383.0/lucide-react.mjs',
    'firebase/app': scope + 'vendor/firebase/10.12.2/firebase-app.js',
    'firebase/firestore': scope + 'vendor/firebase/10.12.2/firebase-firestore.js',
    'firebase/auth': scope + 'vendor/firebase/10.12.2/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js': scope + 'vendor/firebase/10.12.2/firebase-app.js',
    '/react@18.3.1/es2022/react.mjs': scope + 'vendor/react/18.3.1/react.mjs',
    '/scheduler@^0.23.2?target=es2022': scope + 'vendor/scheduler/0.23.2/scheduler.mjs'
  });
  for (const target of Object.values(imports)) {
    assert(target.startsWith(scope + 'vendor/'), target);
    assert(fs.existsSync(path.join(root, target.slice(scope.length))), target);
  }
  assert.match(read('vendor/react-dom/18.3.1/client.mjs'), /from"\.\/react-dom\.mjs"/);
  assert.match(read('vendor/react-dom/18.3.1/react-dom.mjs'), /from"\/react@18\.3\.1\/es2022\/react\.mjs"/);
  assert.match(read('vendor/react-dom/18.3.1/react-dom.mjs'), /from"\/scheduler@\^0\.23\.2\?target=es2022"/);
  assert.match(read('vendor/lucide-react/0.383.0/lucide-react.mjs'), /from"react"/);
  for (const service of ['auth', 'firestore']) {
    assert.match(read(`vendor/firebase/10.12.2/firebase-${service}.js`), /from"https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-app\.js"/);
  }
});

test('the shell contains every statically reachable local module and vendored runtime', async () => {
  const shell = await shellInventory();
  assert.equal(shell.size, 48);
  for (const file of reachableLocalModules()) assert(shell.has(file), file);
  assert(shell.has('js/pwa-register.mjs'));
  for (const [, file] of artifacts) assert(shell.has(file), file);
  for (const file of shell) assert(fs.existsSync(path.join(root, file)), file);
});
