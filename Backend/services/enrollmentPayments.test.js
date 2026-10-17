const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAdvance, validateInstallmentRequest, paymentIdFor, toMinorUnits, hasRecentAuthentication, demoPaymentsAllowed } = require('./enrollmentPayments');

test('validates half-advance using integer paise and an authoritative fee value', () => {
  assert.deepEqual(validateAdvance(10000, 20000), { ok: true, fee: 2000000, amount: 1000000, minimum: 1000000, remaining: 1000000 });
  assert.equal(validateAdvance(9999.99, 20000).ok, false);
  assert.equal(validateAdvance(20000.01, 20000).ok, false);
  assert.equal(validateAdvance(0, 20000).ok, false);
  assert.equal(validateAdvance(-1, 20000).ok, false);
  assert.equal(validateAdvance('abc', 20000).ok, false);
  assert.equal(validateAdvance(10.001, 100).ok, false);
  assert.equal(toMinorUnits('12.35'), 1235);
});

test('requires recent Firebase authentication and rejects stale, future, or missing auth times', () => {
  assert.equal(hasRecentAuthentication(900, 1000), true);
  assert.equal(hasRecentAuthentication(699, 1000), false);
  assert.equal(hasRecentAuthentication(1001, 1000), false);
  assert.equal(hasRecentAuthentication(undefined, 1000), false);
});

test('validates an installment request against the stored balance without recording it as paid', () => {
  assert.deepEqual(validateInstallmentRequest(250, 1000, 500, 500), { ok: true, total: 100000, paid: 50000, balance: 50000, amount: 25000 });
  assert.equal(validateInstallmentRequest(501, 1000, 500, 500).code, 'AMOUNT_TOO_HIGH');
  assert.equal(validateInstallmentRequest(100, 1000, 500, 499).code, 'FEE_RECORD_INVALID');
});

test('creates stable opaque idempotency payment IDs', () => {
  const first = paymentIdFor('student-a', 'retry-key-12345678');
  assert.equal(first, paymentIdFor('student-a', 'retry-key-12345678'));
  assert.notEqual(first, paymentIdFor('student-a', 'retry-key-87654321'));
  assert.match(first, /^demo_[a-f0-9]{64}$/);
});

test('allows demo payments locally but disables them in production by default', () => {
  assert.equal(demoPaymentsAllowed('development', 'false'), true);
  assert.equal(demoPaymentsAllowed('test', 'false'), true);
  assert.equal(demoPaymentsAllowed('production', 'false'), false);
  assert.equal(demoPaymentsAllowed('production', 'true'), true);
});
