// 暗号化して HTML を作る一連の処理（build / demo / テストで共通）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { core } from './core.mjs';
import { DEFAULT_SITE, allStrings, parseConfig, privateStrings } from './config.mjs';
import { extractVault, renderHtml } from './render.mjs';

export function loadConfig(file) {
  const text = readFileSync(file, 'utf8');
  return { text, cfg: parseConfig(text) };
}

export function readExistingVault(htmlFile) {
  if (!existsSync(htmlFile)) return null;
  return extractVault(readFileSync(htmlFile, 'utf8'));
}

// 平文の設定ファイルが git に入り得る状態なら止める（追跡されている / .gitignore されていない）
export function assertNotTracked(file) {
  const dir = path.dirname(path.resolve(file));
  const git = (args) => {
    try {
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  if (!git(['rev-parse', '--is-inside-work-tree'])) return; // git 管理外
  const name = path.basename(file);
  if (!git(['check-ignore', '-q', '--no-index', name])) {
    throw new Error(
      `${file} が .gitignore の対象外です。平文がコミットされる危険があるので中止しました。\n` +
        `  設定ファイルは vault.yaml という名前にしてください。`
    );
  }
  if (!git(['ls-files', '--error-unmatch', name])) return;
  throw new Error(
    `${file} が git に追跡されています。平文がコミットされる危険があるので中止しました。\n` +
      `  git rm --cached ${path.basename(file)} で追跡を外してから、もう一度実行してください。\n` +
      `  （すでに push 済みなら、中身の合言葉・コード類はすべて変更してください）`
  );
}

export async function createKeys(kdf, passphrase) {
  const dek = core.newDek();
  const slots = [await core.makeSlot(passphrase, dek, kdf, 'passphrase')];
  return { dek, slots };
}

export async function reuseKeys(vault, passphrase) {
  const dek = await core.openSlots(vault, passphrase);
  if (!dek) return null;
  return { dek, slots: vault.slots };
}

export function sameKdf(a, b) {
  return a && b && a.alg === b.alg && a.m === b.m && a.t === b.t && a.p === b.p;
}

function today(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}`;
}

export async function produce({ cfg, configText, keys, date = new Date() }) {
  const pub = { ...cfg.site, updated: today(date) };
  // 中身は「元の YAML（復元用）」と「正規化したデータ（表示用）」の両方を入れる
  const payload = { yaml: configText, data: cfg.data };
  const vault = await core.seal(keys.dek, keys.slots, payload);
  const html = renderHtml(pub, vault);

  // 1) 公開部分に非公開の文字列が混ざっていないか
  //    既定値（ソースに書いてある公開の文字列）と同じものは除く
  const publicStrings = allStrings(pub);
  const defaults = allStrings(DEFAULT_SITE);
  const leaked = privateStrings(cfg.data).filter(
    (s) => publicStrings.some((p) => p.includes(s)) && !defaults.some((d) => d.includes(s))
  );
  if (leaked.length) {
    throw new Error('非公開の内容が公開部分（site:）に含まれています:\n' + leaked.map((s) => '  - ' + s.slice(0, 40)).join('\n'));
  }
  // 2) 出来上がった HTML から取り出して開けるか
  const back = extractVault(html);
  const opened = await core.openWithDek(back, keys.dek);
  if (opened.yaml !== configText) throw new Error('自己検証に失敗しました（復号結果が一致しません）');

  return { html, vault, pub };
}
