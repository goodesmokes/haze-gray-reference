const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNativeModule } = require('./test-support.cjs');

let availability;
test.before(async () => { availability = await importNativeModule('js/domain/catalog-availability.mjs'); });

test('missing legacy availability defaults to Available', () => {
  const size = { key: 'legacy' };
  assert.equal(availability.getSizeAvailability(size), 'available');
  assert.equal(availability.sizeAvailabilityLabel(size), 'Available');
  assert.equal(availability.isSizeOrderable(size), true);
  assert.equal(Object.hasOwn(size, 'availability'), false, 'normalization does not mutate legacy data');
});

test('canonical availability statuses have exact labels and orderability', () => {
  for (const [status, label, orderable] of [
    ['available', 'Available', true],
    ['backordered', 'Backordered', false],
    ['out_of_stock', 'Out of Stock', false]
  ]) {
    const size = { availability: status };
    assert.equal(availability.validateSizeAvailability(status), status);
    assert.equal(availability.getSizeAvailability(size), status);
    assert.equal(availability.sizeAvailabilityLabel(size), label);
    assert.equal(availability.isSizeOrderable(size), orderable);
  }
});

test('explicit malformed availability never silently defaults', () => {
  for (const value of [undefined, null, '', 'Available', 'out-of-stock', 'invalid', 1, {}, []]) {
    assert.throws(() => availability.getSizeAvailability({ availability: value }), /Invalid cigar-size availability/);
  }
  assert.throws(() => availability.getSizeAvailability(null), /Invalid cigar-size record/);
});

test('new size rows default to explicit Available', async () => {
  const { newSizeRow } = await importNativeModule('js/domain/catalog-data.mjs');
  assert.equal(newSizeRow().availability, 'available');
});
