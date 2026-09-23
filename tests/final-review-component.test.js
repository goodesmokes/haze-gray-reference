const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNamedNodes, extractInlineModule, nodeText } = require('./test-support.cjs');

const source = extractInlineModule();
const nodes = collectNamedNodes(source, (name) => ['SaveOrderPanel', 'HazeGrayReference', 'openFinalReview', 'emailOrder', 'copyOrderText'].includes(name));
const savePanel = nodeText(source, nodes, 'SaveOrderPanel');
const root = nodeText(source, nodes, 'HazeGrayReference');
const finalStart = root.indexOf(') : showFinalReview && canUseFinalReview ? (');
const finalEnd = root.indexOf(') : showOrderBuilder && canUseOrderBuilder ? (', finalStart);
assert(finalStart >= 0 && finalEnd > finalStart, 'Final Review branch');
const finalReview = root.slice(finalStart, finalEnd);

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
  assert.match(root, /<SaveOrderPanel key=\{`\$\{user\.uid\}:\$\{userProfile\.role\}`\}/);
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
  assert.match(savePanel, /onClick=\{\(\) => save\(true\)\}>Retry This ID With Current Draft/);
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
  assert.match(savePanel, /disabled=\{saving \|\| \(!attempt && !draft\.orderItems\.length\)\}/);
  assert.match(savePanel, /if \(startNew\) onStartNew\(\); else onContinue\(\)/);
  assert.match(savePanel, /Continue Editing Current Order/);
  assert.match(savePanel, /Start New Order \(clear current draft\)/);
});

test('Final Review preserves retailer, notes, line pricing and order-total rendering', () => {
  assert.match(finalReview, /Final Review/);
  assert.match(finalReview, /\{orderRetailer \|\| "—"\}/);
  assert.match(finalReview, /\{orderEmail \|\| "—"\}/);
  assert.match(finalReview, /orderItems\.map\(\(li\) => \{/);
  assert.match(finalReview, /const lineTotal = li\.unitPrice \* li\.qty/);
  for (const expression of ['{li.cigarName}', '{li.packLabel}', '{li.qty}', '${lineTotal.toFixed(2)}', '${orderWholesaleTotal.toFixed(2)}', '{orderNotes}']) {
    assert(finalReview.includes(expression), expression);
  }
  assert.match(finalReview, /onClick=\{\(\) => setShowFinalReview\(false\)\}[\s\S]*?Back to Order Builder/);
  assert.match(finalReview, /onClick=\{\(\) => setShowFinalReview\(false\)\}[\s\S]*?Back to Builder/);
});

test('Final Review preserves permission and empty-order gates plus Save/Continue/Start New wiring', () => {
  assert.match(root, /showFinalReview && canUseFinalReview/);
  assert.match(root, /const openFinalReview = \(\) => \{[\s\S]*?if \(!requirePermission\("canUseFinalReview"\)\) return;[\s\S]*?setShowFinalReview\(true\)/);
  assert.match(root, /orderItems\.length > 0 && \([\s\S]*?onClick=\{openFinalReview\}/);
  assert.match(finalReview, /<SaveOrderPanel key=\{`\$\{user\.uid\}:\$\{userProfile\.role\}`\}[\s\S]*?onContinue=\{openOrderBuilder\}/);
  assert.match(finalReview, /onStartNew=\{\(\) => \{ clearOrder\(\); openOrderBuilder\(\); \}\}/);
  assert.match(savePanel, /buildSavedOrder\(draft, user, profile\)/);
  assert.match(savePanel, /disabled=\{saving \|\| \(!attempt && !draft\.orderItems\.length\)\}/);
});

test('Final Review preserves email/copy actions and their current failure contracts', () => {
  assert.equal((finalReview.match(/if \(!requirePermission\("canUseFinalReview"\)\) return/g) || []).length, 2);
  assert.match(finalReview, /const mailto =[\s\S]*?`mailto:\$\{encodeURIComponent\(retailerEmail\)\}`[\s\S]*?window\.location\.href = mailto/);
  assert.match(finalReview, /await navigator\.clipboard\.writeText\(text\)/);
  assert.match(finalReview, /setCopyConfirmed\(true\)/);
  assert.match(finalReview, /setTimeout\(\(\) => setCopyConfirmed\(false\), 2000\)/);
  assert.doesNotMatch(finalReview, /catch\s*\(/, 'Final Review currently has no copy/email failure UI');
  assert.match(finalReview, /Email Order/);
  assert.match(finalReview, /\{copyConfirmed \? "Copied!" : "Copy Order"\}/);
});
