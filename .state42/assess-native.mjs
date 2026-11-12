import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [directory, mode = 'before'] = process.argv.slice(2);
assert(['before', 'after'].includes(mode));
const results = JSON.parse(fs.readFileSync(path.join(directory, 'jest-results.json'), 'utf8'));
const log = fs.readFileSync(path.join(directory, 'native.log'), 'utf8');
const exitCode = Number(fs.readFileSync(path.join(directory, 'test-exit-code.txt'), 'utf8').trim());
const tests = results.testResults.flatMap((suite) => suite.assertionResults);
const marker = 'STATE42_NATIVE_RECEIPT ';
const receipts = log.split('\n').filter((line) => line.includes(marker) && line.slice(line.indexOf(marker) + marker.length).trim().startsWith('{')).map((line) => JSON.parse(line.slice(line.indexOf(marker) + marker.length)));
const xml = (text) => String(text).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
const failures = tests.filter((test) => test.status === 'failed');
fs.writeFileSync(path.join(directory, 'native-junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${tests.length}" failures="${failures.length}" errors="${results.numRuntimeErrorTestSuites || 0}" skipped="${results.numPendingTests || 0}"><testsuite name="state42-public-resetField" tests="${tests.length}" failures="${failures.length}" errors="${results.numRuntimeErrorTestSuites || 0}" skipped="${results.numPendingTests || 0}">${tests.map((test) => `<testcase classname="${xml(test.ancestorTitles.join(' / '))}" name="${xml(test.title)}">${test.status === 'failed' ? `<failure type="AssertionError">${xml(test.failureMessages.join('\n'))}</failure>` : ''}</testcase>`).join('')}</testsuite></testsuites>\n`);
fs.writeFileSync(path.join(directory, 'rendered-receipts.json'), JSON.stringify(receipts, null, 2));

assert.equal(results.numTotalTests, 6);
assert.equal(results.numPassedTests, mode === 'before' ? 4 : 6);
assert.equal(results.numFailedTests, mode === 'before' ? 2 : 0);
assert.equal(results.numRuntimeErrorTestSuites || 0, 0);
assert.equal(results.numPendingTests || 0, 0);
assert.equal(results.numTodoTests || 0, 0);
assert.equal(results.numPendingTestSuites || 0, 0);
assert.equal(tests.length, 6);
assert.equal(exitCode, mode === 'before' ? 1 : 0);
assert.equal(receipts.length, 6);
assert.equal(new Set(receipts.map((item) => `${item.kind}/${item.resetKind}`)).size, 6);
const expectedStarts = [{ name: 'itemCode', value: 'retired-item' }, { name: 'batchCode', value: 'closed-batch' }];
for (const receipt of receipts) {
  assert(['built-in', 'resolver'].includes(receipt.kind));
  assert(['field', 'whole-form', 'none'].includes(receipt.resetKind));
  assert.deepEqual(receipt.started, expectedStarts, 'Exactly two finite owned data requests must start');
  assert.equal(receipt.operationCount, 2);
  assert.deepEqual(receipt.initial, { itemValue: 'current-item', batchValue: 'current-batch', itemError: 'none', batchError: 'none' });
  assert.deepEqual(receipt.pending, { itemValue: 'retired-item', batchValue: 'closed-batch', itemError: 'none', batchError: 'none' });
  const expectedValues = { itemValue: receipt.resetKind === 'none' ? 'retired-item' : 'current-item', batchValue: receipt.resetKind === 'whole-form' ? 'current-batch' : 'closed-batch' };
  assert.deepEqual(receipt.afterCancel, { ...expectedValues, itemError: 'none', batchError: 'none' });
  assert.deepEqual(receipt.settled, {
    ...expectedValues,
    itemError: receipt.resetKind === 'whole-form' || (mode === 'after' && receipt.resetKind === 'field') ? 'none' : 'Item is discontinued',
    batchError: receipt.resetKind === 'whole-form' ? 'none' : 'Batch is closed',
  }, 'Rendered values and errors must show the exact supported workflow');
}
for (const test of tests) {
  const fieldReset = test.title.endsWith('reset=field');
  assert.equal(test.status, mode === 'before' && fieldReset ? 'failed' : 'passed');
  if (test.status === 'failed') {
    const message = test.failureMessages.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(message, /Expected:\s+"none"/);
    assert.match(message, /Received:\s+"Item is discontinued"/);
  }
}
assert(!/console\.(error|warn)\b/.test(log), 'No React warnings or runtime console errors may count as reproduction');
const summary = { mode, sourceStatus: 'stock-whole-project', total: tests.length, passed: results.numPassedTests, assertionFailed: results.numFailedTests, runtimeErrors: results.numRuntimeErrorTestSuites || 0, skipped: results.numPendingTests || 0, receiptCount: receipts.length, finiteRequestsPerCase: 2, exitCode, exactExpectedOutcome: true };
fs.writeFileSync(path.join(directory, 'assessment.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
