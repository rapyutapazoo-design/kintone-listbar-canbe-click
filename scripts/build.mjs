import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'plugin', 'manifest.json');

function fail(msg, code = 1) {
  console.error('[build] ' + msg);
  process.exit(code);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail('manifest.json を読めません: ' + e.message);
}

if ('mobile' in manifest) fail('manifest に mobile キーがあります（PC版のみ対象）');
if (manifest.type !== 'APP') fail('manifest.type は APP である必要があります');
const en = manifest.name && manifest.name.en;
if (typeof en !== 'string' || en.length < 1 || en.length > 64) fail('name.en は 1〜64 文字である必要があります');

const refs = [
  ...((manifest.desktop && manifest.desktop.js) || []),
  ...((manifest.config && manifest.config.js) || []),
  manifest.config && manifest.config.html,
  manifest.icon
].filter(Boolean);
for (const r of refs) {
  if (!existsSync(join(root, 'plugin', r))) fail('参照ファイルが存在しません: ' + r);
}

const dist = join(root, 'dist');
const out = join(dist, 'plugin.zip');
mkdirSync(dist, { recursive: true });
rmSync(out, { force: true });

let keyPath = process.env.KRC_PRIVATE_KEY;
if (!keyPath) {
  keyPath = join(root, '.keys', 'private.ppk');
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
    console.log('[build] 秘密鍵を生成しました: .keys/private.ppk（コミットしないこと）');
  }
}

const bin = join(root, 'node_modules', '.bin', 'cli-kintone');
if (!existsSync(bin)) fail('cli-kintone が見つかりません。npm install を実行してください');
const r = spawnSync(
  bin,
  ['plugin', 'pack', '--input', manifestPath, '--output', out, '--private-key', keyPath],
  { stdio: 'inherit' }
);
if (r.status !== 0) fail('plugin pack が失敗しました', r.status || 1);
if (!existsSync(out) || statSync(out).size <= 0) fail('dist/plugin.zip が生成されていません');
console.log('[build] 生成しました: ' + out);
