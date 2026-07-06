const test = require('node:test');
const assert = require('node:assert/strict');

test('firebase module initializes without crashing when service account is missing', () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete require.cache[require.resolve('../firebase')];

  assert.doesNotThrow(() => require('../firebase'));
});
