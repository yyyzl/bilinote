const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
test('canonical Android sources survive clean init and repeated sync', () => {
  const { syncAndroid } = require('./sync-android.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binote-android-'));
  try {
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    const gradle = 'plugins {}\napply(from = "tauri.build.gradle.kts")\n';
    fs.writeFileSync(path.join(dir, 'app/build.gradle.kts'), gradle);
    syncAndroid(dir);
    syncAndroid(dir);
    const result = fs.readFileSync(path.join(dir, 'app/build.gradle.kts'), 'utf8');
    assert.equal((result.match(/apply\(from = "binote.gradle.kts"\)/g) || []).length, 1);
    assert.ok(result.startsWith(gradle));
    const manifest = fs.readFileSync(path.join(dir, 'app/src/main/AndroidManifest.xml'), 'utf8');
    assert.match(manifest, /POST_PROMOTED_NOTIFICATIONS/);
    assert.match(manifest, /TranscribeService/);
    assert.match(manifest, /android.intent.action.SEND/);
    assert.match(manifest, /LiveNotificationDismissReceiver/);
    assert.ok(fs.existsSync(path.join(dir, 'app/src/main/java/com/binote/app/MainActivity.kt')));
    assert.ok(fs.existsSync(path.join(dir, 'app/src/test/java/com/binote/app/LiveTaskNotificationTest.kt')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sync rejects a missing generated project instead of pretending success', () => {
  const { syncAndroid } = require('./sync-android.cjs');
  assert.throws(() => syncAndroid(path.join(os.tmpdir(), 'binote-does-not-exist')), /android init/);
});

test('Android build hooks and CI restore tracked native sources', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.android.conf.json')));
  assert.match(config.build.beforeBuildCommand, /sync-android/);
  assert.match(config.build.beforeDevCommand, /sync-android/);
  assert.match(fs.readFileSync(path.join(root, '../.github/workflows/release.yml'), 'utf8'), /node scripts\/sync-android\.cjs/);
});

test('Android CI supplies the Java 21 runtime required by API 36 Robolectric', () => {
  const workflow = fs.readFileSync(path.join(root, '../.github/workflows/release.yml'), 'utf8');
  const androidJob = workflow.split('  build-android:')[1].split('  release:')[0];
  assert.match(androidJob, /java-version: ['"]21['"]/);
  assert.match(androidJob, /:app:testArm64DebugUnitTest -x rustBuildArm64Debug/);
});

function loadNav() {
  const source = fs.readFileSync(path.join(root, 'src/lib/notification-nav.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  return exports;
}

test('task-list and note clicks survive cold-start buffering and map to safe routes', () => {
  const nav = loadNav();
  assert.equal(nav.notificationRoute('@tasks'), '/');
  assert.equal(nav.notificationRoute(' note-1 '), '/note/note-1');
  assert.equal(nav.notificationRoute(''), null);
  assert.equal(nav.notificationRoute('../settings'), null);
  assert.equal(nav.receiveNotificationClick('@tasks'), false);
  const routes = [];
  nav.registerNavHandler(id => routes.push(nav.notificationRoute(id)));
  nav.receiveNotificationClick('note-1');
  assert.deepEqual(routes, ['/', '/note/note-1']);
  nav.unregisterNavHandler();
  nav.receiveNotificationClick('note-2');
  nav.registerNavHandler(id => routes.push(nav.notificationRoute(id)));
  assert.deepEqual(routes, ['/', '/note/note-1', '/note/note-2']);
});
