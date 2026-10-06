// 単体 HTML を組み立てる
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function argon2Source() {
  const path = require.resolve('hash-wasm/dist/argon2.umd.min.js');
  return readFileSync(path, 'utf8');
}

// <script> の中に入れても途中で閉じられないようにする
function scriptSafe(js, name) {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--').replace(/^/, `/* ${name} */\n`);
}

function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const FONTS_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=BIZ+UDGothic:wght@400;700&display=swap">';

function csp(googleFonts) {
  const style = googleFonts ? "'unsafe-inline' https://fonts.googleapis.com" : "'unsafe-inline'";
  const font = googleFonts ? 'https://fonts.gstatic.com' : "'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
    `style-src ${style}`,
    `font-src ${font}`,
    "img-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

// 差し込み部分（公開情報）だけを返す。漏洩チェックに使う。
export function renderHtml(pub, vault) {
  const template = read('../../src/template.html');
  const css = read('../../src/style.css');
  const core = read('../../src/core.js');
  const app = read('../../src/app.js');

  const themeVars = `:root{--accent:${pub.theme.accent};--warn:${pub.theme.warn};}`;
  const parts = {
    __TITLE__: escapeHtml(pub.title),
    __CSP__: escapeHtml(csp(pub.ui.googleFonts)),
    __FONTS__: pub.ui.googleFonts ? FONTS_LINK : '',
    __CSS__: (themeVars + '\n' + css).replace(/<\/(style)/gi, '<\\/$1'),
    __PUBLIC__: jsonForScript(pub),
    __VAULT__: jsonForScript(vault),
    __ARGON2__: scriptSafe(argon2Source(), 'hash-wasm argon2 (MIT, (c) Dani Biro)'),
    __CORE__: scriptSafe(core, 'src/core.js'),
    __APP__: scriptSafe(app, 'src/app.js')
  };
  for (const token of Object.keys(parts)) {
    if (!template.includes(token)) throw new Error(`template.html に ${token} がありません`);
  }
  // 1 回の置換で済ませる（差し込んだ中身に偶然トークンが含まれていても再置換しない）
  return template.replace(/__(TITLE|CSP|FONTS|CSS|PUBLIC|VAULT|ARGON2|CORE|APP)__/g, (t) => parts[t]);
}

// 生成済み HTML から暗号データを取り出す
export function extractVault(html) {
  const m = html.match(/<script type="application\/json" id="hjg-vault">([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1]);
}
