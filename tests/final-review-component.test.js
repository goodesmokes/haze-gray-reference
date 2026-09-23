const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, nodeText, parseModule, readRepositoryFile } = require('./test-support.cjs');

const source = extractInlineModule();
const nodes = collectNamedNodes(source, (name) => ['HazeGrayReference', 'openFinalReview', 'emailOrder', 'copyOrderText', 'emailFinalOrder', 'copyFinalOrder'].includes(name));
const panelSource = readRepositoryFile('js/components/save-order-panel.mjs');
const panelNodes = collectNamedNodes(panelSource, (name) => name === 'SaveOrderPanel');
const savePanel = nodeText(panelSource, panelNodes, 'SaveOrderPanel');
const root = nodeText(source, nodes, 'HazeGrayReference');
const finalSource = readRepositoryFile('js/components/final-review.mjs');
const finalNodes = collectNamedNodes(finalSource, (name) => name === 'FinalReview');
const finalReview = nodeText(finalSource, finalNodes, 'FinalReview');

test('SaveOrderPanel restores a UID-scoped pending receipt and preserves the remount boundary', () => {
  assert.match(savePanel, /const storageKey = `haze-gray-cigars\.pending-order-save\.v1\.\$\{user\.uid\}`/);
  assert.match(savePanel, /useState\(\(\) => \{[\s\S]*?JSON\.parse\(localStorage\.getItem\(storageKey\)\)[\s\S]*?value\?\.uid === user\.uid && typeof value\.id === "string" && value\.payload \? value : null/);
  for (const initializer of [
    'const attemptRef = useRef(attempt)',
    'const busy = useRef(false)',
    'const mounted = useRef(true)',
    'const [saving, setSaving] = useState(false)',
    'const [saved, setSaved] = useState(false)',
    'const [message, setMessage] = useState("")'
  ]) assert(savePanel.includes(initializer), initializer);
  assert.match(finalReview, /key: `\$\{user\.uid\}:\$\{userProfile\.role\}`/);
});

test('SaveOrderPanel persists before writing and retries the same order ID', () => {
  const saveAction = savePanel.slice(savePanel.indexOf('const save = async'), savePanel.indexOf('let priceCheck'));
  const createIndex = savePanel.indexOf('pending = { uid: user.uid, id: doc(collection(db, "orders")).id');
  const persistIndex = savePanel.indexOf('localStorage.setItem(storageKey, JSON.stringify(pending))', createIndex);
  const saveIndex = savePanel.indexOf('await savePendingOrder(pending, user.uid, permitted, cigars, packOptions)', persistIndex);
  assert(createIndex >= 0 && persistIndex > createIndex && saveIndex > persistIndex, 'receipt persists before the network write');
  assert.match(savePanel, /let pending = attemptRef\.current/);
  assert.match(savePanel, /if \(useCurrentDraft\) \{[\s\S]*?pending = \{ \.\.\.pending, payload: buildSavedOrder\(draft, user, profile\) \}/);
  assert.match(savePanel, /attemptRef\.current = pending; setAttempt\(pending\)/);
  assert.match(savePanel, /onClick: \(\) => save\(true\) \}, "Retry This ID With Current Draft"/);
  assert.match(savePanel, /Retry uses that captured order, even if you have since edited the draft\./);
  assert.doesNotMatch(saveAction, /localStorage\.removeItem/, 'failed or uncertain saves keep the receipt');
});

test('SaveOrderPanel preserves busy, mounted, messaging and finish callback guards', () => {
  assert.match(savePanel, /if \(busy\.current \|\| saved \|\| !permitted\(\)\) return/);
  assert.match(savePanel, /busy\.current = true; setSaving\(true\); setMessage\(""\)/);
  assert.match(savePanel, /mounted\.current = true; return \(\) => \{ mounted\.current = false; \}/);
  assert.match(savePanel, /if \(mounted\.current && permitted\(\)\) \{ setSaved\(true\); setMessage\("This order has been recorded in Order History\. Your active draft has not been cleared\."\); \}/);
  assert.match(savePanel, /if \(mounted\.current && permitted\(\)\) \{[\s\S]*?Save could not be confirmed:[\s\S]*?Retry checks the same order ID\. Your draft is unchanged\./);
  assert.match(savePanel, /finally \{ busy\.current = false; if \(mounted\.current\) setSaving\(false\); \}/);
  assert.match(savePanel, /disabled: saving \|\| \(!attempt && !draft\.orderItems\.length\)/);
  assert.match(savePanel, /if \(startNew\) onStartNew\(\); else onContinue\(\)/);
  assert.match(savePanel, /Continue Editing Current Order/);
  assert.match(savePanel, /Start New Order \(clear current draft\)/);
});

test('Final Review preserves retailer, notes, line pricing and order-total rendering', () => {
  assert.match(finalReview, /Final Review/);
  assert.match(finalReview, /orderRetailer \|\| "—"/);
  assert.match(finalReview, /orderEmail \|\| "—"/);
  assert.match(finalReview, /orderItems\.map\(\(line\) => \{/);
  assert.match(finalReview, /const lineTotal = line\.unitPrice \* line\.qty/);
  for (const expression of ['line.cigarName', 'line.packLabel', 'line.qty', 'lineTotal.toFixed(2)', 'orderWholesaleTotal.toFixed(2)', 'orderNotes']) {
    assert(finalReview.includes(expression), expression);
  }
  assert.match(finalReview, /onClick: onBack[\s\S]*?Back to Order Builder/);
  assert.match(finalReview, /onClick: onBack[\s\S]*?Back to Builder/);
});

test('Final Review preserves permission and empty-order gates plus Save/Continue/Start New wiring', () => {
  assert.match(root, /showFinalReview && canUseFinalReview/);
  assert.match(root, /const openFinalReview = \(\) => \{[\s\S]*?if \(!requirePermission\("canUseFinalReview"\)\) return;[\s\S]*?setShowFinalReview\(true\)/);
  assert.match(root, /orderItems\.length > 0 && \([\s\S]*?onClick=\{openFinalReview\}/);
  assert.match(root, /<FinalReview draft=\{activeDraft\}[\s\S]*?onContinue=\{openOrderBuilder\}[\s\S]*?onStartNew=\{\(\) => \{ clearOrder\(\); openOrderBuilder\(\); \}\}/);
  assert.match(finalReview, /h\(SaveOrderPanel, \{ key: `\$\{user\.uid\}:\$\{userProfile\.role\}`[\s\S]*?onContinue, onStartNew \}\)/);
  assert.match(savePanel, /buildSavedOrder\(draft, user, profile\)/);
  assert.match(savePanel, /disabled: saving \|\| \(!attempt && !draft\.orderItems\.length\)/);
});

test('Final Review preserves email/copy actions and their current failure contracts', () => {
  const emailFinalOrder = nodeText(source, nodes, 'emailFinalOrder');
  const copyFinalOrder = nodeText(source, nodes, 'copyFinalOrder');
  assert.match(emailFinalOrder, /if \(!requirePermission\("canUseFinalReview"\)\) return/);
  assert.match(copyFinalOrder, /if \(!requirePermission\("canUseFinalReview"\)\) return/);
  assert.match(emailFinalOrder, /const mailto =[\s\S]*?`mailto:\$\{encodeURIComponent\(retailerEmail\)\}`[\s\S]*?window\.location\.href = mailto/);
  assert.match(copyFinalOrder, /await navigator\.clipboard\.writeText\(text\)/);
  assert.match(copyFinalOrder, /setCopyConfirmed\(true\)/);
  assert.match(copyFinalOrder, /setTimeout\(\(\) => setCopyConfirmed\(false\), 2000\)/);
  assert.doesNotMatch(`${emailFinalOrder}\n${copyFinalOrder}`, /catch\s*\(/, 'Final Review currently has no copy/email failure UI');
  assert.match(finalReview, /onClick: onEmail/);
  assert.match(finalReview, /onClick: onCopy/);
  assert.match(finalReview, /Email Order/);
  assert.match(finalReview, /copyConfirmed \? "Copied!" : "Copy Order"/);
});

test('app imports FinalReview and the module reuses SaveOrderPanel without duplicate implementations', () => {
  const imports = parseModule(source).program.body.filter((node) => node.type === 'ImportDeclaration');
  const finalImport = imports.find((node) => node.source.value === './js/components/final-review.mjs');
  assert.deepEqual(finalImport.specifiers.map((node) => node.imported.name), ['FinalReview']);
  assert.equal(imports.some((node) => node.source.value === './js/components/save-order-panel.mjs'), false);
  const finalImports = parseModule(finalSource).program.body.filter((node) => node.type === 'ImportDeclaration');
  const panelImport = finalImports.find((node) => node.source.value === './save-order-panel.mjs');
  assert.deepEqual(panelImport.specifiers.map((node) => node.imported.name), ['SaveOrderPanel']);
  assert.deepEqual([...collectNamedNodes(source, (name) => name === 'SaveOrderPanel').keys()], []);
  assert.deepEqual([...panelNodes.keys()], ['SaveOrderPanel']);
  assert.deepEqual([...collectNamedNodes(source, (name) => name === 'FinalReview').keys()], []);
  assert.deepEqual([...finalNodes.keys()], ['FinalReview']);
  assert.match(panelSource, /export function SaveOrderPanel/);
  assert.match(finalSource, /export function FinalReview/);
  assert.doesNotMatch(root, /haze-gray-cigars\.pending-order-save|attemptRef|savePendingOrder/);
  assert.doesNotMatch(root, /REVIEW ORDER BEFORE SUBMISSION|Email Order|Back to Builder/);
});
