const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./client-helpers.cjs');
const { collectNamedNodes, extractInlineModule, nodeText, readRepositoryFile } = require('./test-support.cjs');

const source = extractInlineModule();
const names = ['HazeGrayReference', 'openAdd', 'openEdit', 'setSizeField', 'addSizeRow', 'removeSizeRow', 'saveForm', 'saveCigarDoc', 'doDelete'];
const nodes = collectNamedNodes(source, (name) => names.includes(name));
const root = nodeText(source, nodes, 'HazeGrayReference');
const text = (name) => nodeText(source, nodes, name);
const compile = (name, environment) => Function(...Object.keys(environment), `return ${text(name)}`)(...Object.values(environment));
const client = loadClient();
const catalogSource = readRepositoryFile('js/domain/catalog-data.mjs');
const catalogNodes = collectNamedNodes(catalogSource, (name) => ['newSizeRow', 'EMPTY_FORM'].includes(name));
const newSizeRow = Function(`return ${nodeText(catalogSource, catalogNodes, 'newSizeRow')}`)();
const EMPTY_FORM = Function('newSizeRow', `return ${nodeText(catalogSource, catalogNodes, 'EMPTY_FORM')}`)(newSizeRow);
const editorMarkup = readRepositoryFile('js/components/catalog-editor.mjs');

test('Catalog Editor add and edit entry points reset from defaults or the selected cigar', () => {
  let form;
  let editingId = 'stale-id';
  let formOpen = false;
  const setters = {
    setForm: (value) => { form = value; },
    setEditingId: (value) => { editingId = value; },
    setFormOpen: (value) => { formOpen = value; }
  };
  const openAdd = compile('openAdd', { requirePermission: () => true, setForm: setters.setForm, EMPTY_FORM, ...setters });
  openAdd();
  assert.equal(form, EMPTY_FORM);
  assert.equal(editingId, null);
  assert.equal(formOpen, true);

  const openEdit = compile('openEdit', { requirePermission: () => true, setForm: setters.setForm, newSizeRow, ...setters });
  const cigarA = { id: 'a', name: 'Alpha', tastingNotes: ['cedar'], pairings: ['rum'], sizes: [{ key: 'a-size', vitola: 'Toro', dims: '52 x 6', msrp: '$12' }] };
  const cigarB = { id: 'b', name: 'Bravo', tastingNotes: [], pairings: [], sizes: [] };
  openEdit(cigarA);
  assert.equal(editingId, 'a');
  assert.equal(form.name, 'Alpha');
  assert.equal(form.tastingNotes, 'cedar');
  assert.equal(form.pairings, 'rum');
  assert.deepEqual({ ...form.sizes[0], key: 'stable' }, { ...newSizeRow(), ...cigarA.sizes[0], key: 'stable' });
  openEdit(cigarB);
  assert.equal(editingId, 'b');
  assert.equal(form.name, 'Bravo');
  assert.equal(form.tastingNotes, '');
  assert.equal(form.pairings, '');
  assert.equal(form.sizes.length, 1);
  assert.deepEqual({ ...form.sizes[0], key: 'stable' }, { ...newSizeRow(), key: 'stable' });
  openAdd();
  assert.equal(form, EMPTY_FORM, 'reopening Add mode does not retain the previous edit target');
  assert.equal(editingId, null);
});

test('Catalog Editor size handlers preserve immutable add, edit and remove behavior with permission gates', () => {
  let form = { sizes: [{ ...newSizeRow(), key: 'one' }] };
  const setForm = (update) => { form = update(form); };
  const environment = { requirePermission: (permission) => permission === 'canEditPackages', setForm, newSizeRow };
  const setSizeField = compile('setSizeField', environment);
  const addSizeRow = compile('addSizeRow', environment);
  const removeSizeRow = compile('removeSizeRow', environment);
  const original = form.sizes[0];
  for (const [field, value] of [['vitola', 'Robusto'], ['dims', '50 x 5'], ['msrp', '$12.00'], ['keystoneSingle', '$6.00 box / $5.75 bundle'], ['keystoneBox10', '$60'], ['keystoneBox20', '$115'], ['keystoneBundle20', '$110']]) {
    setSizeField(0, field, value);
  }
  assert.notEqual(form.sizes[0], original);
  assert.equal(form.sizes[0].vitola, 'Robusto');
  assert.equal(form.sizes[0].keystoneBundle20, '$110');
  addSizeRow();
  assert.equal(form.sizes.length, 2);
  assert.deepEqual({ ...form.sizes[1], key: 'stable' }, { ...newSizeRow(), key: 'stable' });
  removeSizeRow(0);
  assert.equal(form.sizes.length, 1);
  assert.notEqual(form.sizes[0].key, 'one');

  const blocked = compile('addSizeRow', { requirePermission: () => false, setForm: () => assert.fail('blocked package edit mutated form'), newSizeRow });
  blocked();
});

test('Catalog Editor save preserves add/edit IDs and the exact catalog record shape', async () => {
  const baseForm = {
    ...EMPTY_FORM,
    name: '  Test Cigar  ',
    line: 'Line',
    imageUrl: '/haze-gray-reference/assets/cigars/Backpack.webp',
    strength: '4',
    body: '3',
    tastingNotes: 'cedar, cocoa, ',
    pairings: 'rum, coffee',
    sizes: [{
      key: 'size-1', vitola: ' Toro ', dims: ' 52 x 6 ', msrp: ' $12.00 ',
      keystoneSingle: ' $6.00 box / $5.75 bundle ', keystoneBox10: ' $60 ',
      keystoneBox20: '', keystoneBundle20: 'bad'
    }, newSizeRow()]
  };
  const runSave = async (editingId) => {
    let saved;
    let open = true;
    let saving = false;
    const saveForm = compile('saveForm', {
      requirePermission: () => true,
      catalogSaveBusyRef: { current: false },
      form: structuredClone(baseForm),
      editingId,
      Date: { now: () => 12345 },
      parseMoney: client.parseMoney,
      getSinglePrice: client.getSinglePrice,
      saveCigarDoc: async (record) => { saved = record; return true; },
      setEditingId: () => {},
      setCatalogSaving: (value) => { saving = value; },
      setFormOpen: (value) => { open = value; }
    });
    await saveForm();
    return { saved, open, saving };
  };
  const added = await runSave(null);
  assert.equal(added.saved.id, 'c-12345');
  assert.equal(added.open, false);
  assert.equal(added.saved.name, '  Test Cigar  ', 'non-size form fields retain their existing shape');
  assert.equal(added.saved.imageUrl, baseForm.imageUrl, 'existing image data is retained without replacement');
  assert.deepEqual(added.saved.tastingNotes, ['cedar', 'cocoa']);
  assert.deepEqual(added.saved.pairings, ['rum', 'coffee']);
  assert.deepEqual(added.saved.sizes, [{
    key: 'size-1', vitola: 'Toro', dims: '52 x 6', msrp: '$12.00',
    keystoneSingle: '$6.00 box / $5.75 bundle', keystoneBox10: '$60', keystoneBox20: '', keystoneBundle20: 'bad',
    pricing: { msrp: 12, boxSingle: 6, bundleSingle: 5.75, box10: 60, box20: null, bundle20: null }
  }]);
  assert.equal(added.saving, false);
  const edited = await runSave('existing-id');
  assert.equal(edited.saved.id, 'existing-id');
  assert.equal(edited.saved.imageUrl, baseForm.imageUrl, 'ordinary edits preserve the exact static image reference');

  let called = false;
  await compile('saveForm', { catalogSaveBusyRef: { current: false }, requirePermission: () => true, form: { ...baseForm, name: '   ' }, editingId: null, Date, parseMoney: client.parseMoney, getSinglePrice: client.getSinglePrice, saveCigarDoc: () => { called = true; }, setEditingId: () => { called = true; }, setCatalogSaving: () => { called = true; }, setFormOpen: () => { called = true; } })();
  assert.equal(called, false, 'blank names fail closed without saving or closing');
  assert.match(text('saveForm'), /requirePermission\("canEditCatalog"\).*requirePermission\("canEditPackages"\)/s);
});

test('Catalog save and delete remain open while pending and reject duplicate clicks', async () => {
  let resolveSave;
  const savePending = new Promise((resolve) => { resolveSave = resolve; });
  let saveCalls = 0;
  let formOpen = true;
  const saveBusy = { current: false };
  const saveForm = compile('saveForm', {
    catalogSaveBusyRef: saveBusy,
    requirePermission: () => true,
    form: { ...EMPTY_FORM, name: 'Pending Cigar', sizes: [] },
    editingId: 'pending-id',
    Date,
    parseMoney: client.parseMoney,
    getSinglePrice: client.getSinglePrice,
    saveCigarDoc: async () => { saveCalls += 1; return savePending; },
    setEditingId: () => {},
    setCatalogSaving: () => {},
    setFormOpen: (value) => { formOpen = value; }
  });
  const firstSave = saveForm();
  await saveForm();
  assert.equal(saveCalls, 1);
  assert.equal(formOpen, true);
  resolveSave(true);
  await firstSave;
  assert.equal(formOpen, false);
  assert.equal(saveBusy.current, false);

  let resolveDelete;
  const deletePending = new Promise((resolve) => { resolveDelete = resolve; });
  let deleteCalls = 0;
  let confirmation = 'pending-id';
  const deleteBusy = { current: false };
  const doDelete = compile('doDelete', {
    catalogDeleteBusyRef: deleteBusy,
    requirePermission: () => true,
    setCatalogDeleting: () => {},
    deleteCigarDoc: async () => { deleteCalls += 1; return deletePending; },
    setConfirmDeleteId: (value) => { confirmation = value; },
    selectedId: null,
    setSelectedId: () => {}
  });
  const firstDelete = doDelete('pending-id');
  await doDelete('pending-id');
  assert.equal(deleteCalls, 1);
  assert.equal(confirmation, 'pending-id');
  resolveDelete(true);
  await firstDelete;
  assert.equal(confirmation, null);
  assert.equal(deleteBusy.current, false);
});

test('editor offers a static path and preview without file upload controls', () => {
  assert.match(editorMarkup, /Catalog Image Path/);
  assert.match(editorMarkup, /value: form.imageUrl \?\? ""/);
  assert.match(editorMarkup, /src: form.imageUrl/);
  assert.match(editorMarkup, /disabled: saving \|\| !validImage/);
  assert.doesNotMatch(source + editorMarkup, /FileReader|readAsDataURL|toDataURL|fileToCompressedDataUrl|handlePhotoFile|fileInputRef|type: "file"/);
  assert.match(source, /const LOGO_DATA_URL = "data:image\/png;base64,/);
});

test('Catalog Editor modal, permission-loss and delete behavior remain wired at the root', () => {
  assert.match(root, /formOpen && canEditCatalog && canEditPackages/);
  assert.match(root, /<CatalogEditor[\s\S]*?saving=\{catalogSaving\}[\s\S]*?onClose=\{\(\) => \{ if \(!catalogSaving\) setFormOpen\(false\); \}\}/);
  assert.match(editorMarkup, /position: "fixed"[\s\S]*?onClick: saving \? undefined : onClose[\s\S]*?onClick: \(event\) => event\.stopPropagation\(\)[\s\S]*?className: "hg-scroll"/);
  assert.equal((editorMarkup.match(/onClick: onClose/g) || []).length, 2, 'close and Cancel use the guarded close callback');
  assert.match(root, /if \(!canEditCatalog\) \{ setFormOpen\(false\); setConfirmDeleteId\(null\); \}/);
  assert.match(root, /\{formOpen && canEditCatalog && canEditPackages && \(/);
  assert.match(editorMarkup, /onClick: onSave[\s\S]*?saving \? "Saving…" : editingId \? "Save Changes" : "Add Cigar"/);
  assert.match(editorMarkup, /disabled: saving \|\| !validImage/);
  assert.match(root, /confirmDeleteId && canEditCatalog/);
  assert.match(root, /onClick=\{\(\) => doDelete\(confirmDeleteId\)\}/);
  assert.match(text('doDelete'), /catalogDeleteBusyRef\.current[\s\S]*?requirePermission\("canEditCatalog"\)[\s\S]*?await deleteCigarDoc\(id\)[\s\S]*?setConfirmDeleteId\(null\)[\s\S]*?if \(selectedId === id\) setSelectedId\(null\)/);
  assert.match(text('saveCigarDoc'), /saveCatalogRecord\(record\)[\s\S]*?Save failed — your change may not persist/);
});

test('Catalog Editor keeps root permission callbacks without legacy image processing', () => {
  for (const handler of ['openAdd', 'openEdit', 'saveCigarDoc', 'doDelete']) assert.match(text(handler), /requirePermission\("canEditCatalog"\)/, handler);
  for (const handler of ['setSizeField', 'addSizeRow', 'removeSizeRow']) assert.match(text(handler), /requirePermission\("canEditPackages"\)/, handler);
  assert.match(text('saveForm'), /requirePermission\("canEditCatalog"\).*requirePermission\("canEditPackages"\)/s);
  assert.doesNotMatch(editorMarkup, /ROLE_PERMISSIONS|ROLE_LABELS|getProfilePermissions/, 'the editor markup does not duplicate role policy');
  assert.doesNotMatch(text('saveCigarDoc'), /FileReader|Image|canvas|fileToCompressedDataUrl/);
});

test('Catalog Editor is extracted without moving root-owned editor state or duplicating production markup', () => {
  assert.match(source, /import \{ CatalogEditor \} from "\.\/js\/components\/catalog-editor\.mjs"/);
  assert.match(editorMarkup, /export function CatalogEditor\(/);
  assert.equal((source.match(/<CatalogEditor\b/g) || []).length, 1);
  assert.doesNotMatch(source, /function CatalogEditor\s*\(/);
  assert.doesNotMatch(source, /Select Existing Retailer or Manual Entry[\s\S]*?Sizes & Pricing/);
  for (const initializer of [
    'const [formOpen, setFormOpen] = useState(false)',
    'const [editingId, setEditingId] = useState(null)',
    'const [form, setForm] = useState(EMPTY_FORM)'
  ]) assert(root.includes(initializer), initializer);
  assert.match(root, /<CatalogEditor form=\{form\} editingId=\{editingId\}[\s\S]*?onSave=\{saveForm\}/);
});
