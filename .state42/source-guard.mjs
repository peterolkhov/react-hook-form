import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packet = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(packet, 'manifest.json'), 'utf8'));
const [stage, receiptDirectory] = process.argv.slice(2);
assert(['before', 'after'].includes(stage));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = (filename) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
assert.equal(git('rev-parse', 'HEAD'), manifest.sourceRef, 'Whole official tree must be at the pinned SHA');
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Every tracked upstream file must stay clean');
assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).version, manifest.packageVersion);
for (const [filename, expected] of Object.entries(manifest.sourceSHA256)) {
  assert.equal(sha(filename), expected, `Original public source changed: ${filename}`);
}
const fixture = path.join(packet, 'native-resetfield.test.tsx');
assert.equal(sha(fixture), manifest.fixtureSHA256, 'The fixture must remain frozen');
const destination = 'src/__tests__/useForm/state42-resetField.test.tsx';
fs.mkdirSync(receiptDirectory, { recursive: true });
const fileNames = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const tracked = Object.fromEntries(fileNames.map((name) => [name, sha(name)]));
const snapshot = { sourceRef: git('rev-parse', 'HEAD'), trackedFileCount: fileNames.length, sourceSHA256: manifest.sourceSHA256, fixtureSHA256: manifest.fixtureSHA256, trackedClean: true, trackedSHA256: tracked };
if (stage === 'before') {
  assert(!fs.existsSync(destination), 'Do not overwrite an existing upstream test');
  fs.writeFileSync(path.join(receiptDirectory, 'source-before.json'), JSON.stringify(snapshot, null, 2));
  fs.copyFileSync(fixture, destination);
} else {
  assert.equal(sha(destination), manifest.fixtureSHA256, 'The public fixture changed during the run');
  const before = JSON.parse(fs.readFileSync(path.join(receiptDirectory, 'source-before.json'), 'utf8'));
  assert.deepEqual(tracked, before.trackedSHA256, 'A tracked file changed during install/test');
  fs.writeFileSync(path.join(receiptDirectory, 'source-after.json'), JSON.stringify(snapshot, null, 2));
}
console.log(JSON.stringify({ stage, sourceRef: snapshot.sourceRef, trackedClean: true, trackedFileCount: snapshot.trackedFileCount, fixtureSHA256: manifest.fixtureSHA256 }));
