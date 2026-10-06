// 設定ファイル（vault.yaml）の読み込み・検証・正規化
//
// YAML は failsafe スキーマで読む（値はすべて文字列）。
// 電話番号・暗証番号・コードの先頭の 0 が消えたり、数値に化けたりしないようにするため。
import YAML from 'yaml';
import { core } from './core.mjs';

const BLOCK_TYPES = ['steps', 'list', 'text', 'note', 'contacts', 'totp', 'codes', 'secret', 'entries'];
const ITEM_BLOCKS = ['steps', 'list', 'contacts', 'totp', 'codes', 'entries'];
const TEXT_BLOCKS = ['text', 'note'];
const FIELD_TYPES = ['text', 'tel', 'url', 'email'];
// 章の見分け方: tone（地の段差）/ meaning（意味のハッチング）/ module（見出し帯）/ index（区画番号）/ none
const SECTION_STYLES = ['tone', 'meaning', 'module', 'index', 'none'];

export const DEFAULT_SITE = {
  title: '非常口',
  lock: {
    label: 'AUTHENTICATION',
    greeting: '(｀・ω・´)ゞ 合言葉の入力を待機中',
    passphraseLabel: 'PASSPHRASE',
    button: '解除 ▸',
    showInput: '入力内容を表示'
  },
  ui: {
    googleFonts: true,
    sectionStyle: 'meaning'
  },
  theme: {
    accent: '#5fe3ff',
    warn: '#ffc35a'
  },
  labels: {
    locked: 'LOCKED',
    unlocked: 'UNLOCKED',
    deriving: '鍵を導出中…',
    denied: 'ACCESS DENIED — 合言葉が一致しません',
    show: '表示',
    hide: '秘匿',
    copy: '複写',
    copied: '複写完了',
    hideAll: '全部隠す',
    lock: 'ロック',
    sections: '目次',
    seed: 'SEED',
    codeCopied: 'COPIED',
    updated: 'LAST UPDATE'
  }
};

export class ConfigError extends Error {
  constructor(problems) {
    super('設定ファイルに問題があります:\n' + problems.map((p) => '  - ' + p).join('\n'));
    this.problems = problems;
  }
}

function isMap(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(s)) return true;
  if (['false', 'no', 'off', '0'].includes(s)) return false;
  return fallback;
}

function parseInt10(v, fallback, problems, where, min, max) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${where}: ${min}〜${max} の整数にしてください（今: ${v}）`);
    return fallback;
  }
  return n;
}

function mergeStrings(base, over, problems, where) {
  const out = { ...base };
  if (over === undefined) return out;
  if (!isMap(over)) {
    problems.push(`${where}: 「キー: 値」の形にしてください`);
    return out;
  }
  for (const [k, v] of Object.entries(over)) {
    if (!Object.hasOwn(base, k)) {
      problems.push(`${where}.${k}: 知らない項目です`);
      continue;
    }
    out[k] = str(v);
  }
  return out;
}

function normalizeSite(raw, problems) {
  const site = raw === undefined ? {} : raw;
  if (!isMap(site)) {
    problems.push('site: 「キー: 値」の形にしてください');
    return structuredClone(DEFAULT_SITE);
  }
  const known = ['title', 'lock', 'ui', 'theme', 'labels'];
  for (const k of Object.keys(site)) if (!known.includes(k)) problems.push(`site.${k}: 知らない項目です`);

  const ui = site.ui === undefined ? {} : site.ui;
  if (!isMap(ui)) problems.push('site.ui: 「キー: 値」の形にしてください');
  const theme = mergeStrings(DEFAULT_SITE.theme, site.theme, problems, 'site.theme');
  for (const [k, v] of Object.entries(theme)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      problems.push(`site.theme.${k}: #rrggbb の形の色にしてください（今: ${v}）`);
      theme[k] = DEFAULT_SITE.theme[k];
    }
  }
  return {
    title: site.title === undefined ? DEFAULT_SITE.title : str(site.title),
    lock: mergeStrings(DEFAULT_SITE.lock, site.lock, problems, 'site.lock'),
    ui: {
      googleFonts: parseBool(isMap(ui) ? ui.googleFonts : undefined, DEFAULT_SITE.ui.googleFonts),
      sectionStyle: (() => {
        const v = isMap(ui) && ui.sectionStyle !== undefined ? str(ui.sectionStyle) : DEFAULT_SITE.ui.sectionStyle;
        if (!SECTION_STYLES.includes(v)) {
          problems.push(`site.ui.sectionStyle: ${SECTION_STYLES.join(' / ')} のどれかにしてください（今: ${v}）`);
          return DEFAULT_SITE.ui.sectionStyle;
        }
        return v;
      })()
    },
    theme,
    labels: mergeStrings(DEFAULT_SITE.labels, site.labels, problems, 'site.labels')
  };
}

function normalizeKdf(raw, problems) {
  const k = raw === undefined ? {} : raw;
  if (!isMap(k)) {
    problems.push('kdf: 「キー: 値」の形にしてください');
    return { ...core.DEFAULT_KDF };
  }
  const known = ['memoryMiB', 'iterations', 'parallelism'];
  for (const key of Object.keys(k)) if (!known.includes(key)) problems.push(`kdf.${key}: 知らない項目です`);
  return {
    alg: 'argon2id',
    m: parseInt10(k.memoryMiB, core.DEFAULT_KDF.m / 1024, problems, 'kdf.memoryMiB', 16, 1024) * 1024,
    t: parseInt10(k.iterations, core.DEFAULT_KDF.t, problems, 'kdf.iterations', 1, 20),
    p: parseInt10(k.parallelism, core.DEFAULT_KDF.p, problems, 'kdf.parallelism', 1, 4)
  };
}

function needString(v, where, problems) {
  if (v === undefined || v === null || (typeof v === 'object')) {
    problems.push(`${where}: 文字列が必要です`);
    return '';
  }
  return String(v);
}

function stringList(v, where, problems) {
  if (!Array.isArray(v)) {
    problems.push(`${where}: リスト（- で始まる行）にしてください`);
    return [];
  }
  return v.map((x, i) => needString(x, `${where}[${i}]`, problems));
}

function checkKeys(obj, allowed, where, problems) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) problems.push(`${where}.${k}: 知らない項目です`);
}

function parseOtpauth(uri, where, problems) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    problems.push(`${where}.uri: otpauth:// の URI として読めません`);
    return {};
  }
  if (u.protocol !== 'otpauth:' || u.host !== 'totp') {
    problems.push(`${where}.uri: otpauth://totp/... の形だけ対応しています`);
    return {};
  }
  const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const [issuerFromLabel, account] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
  const p = u.searchParams;
  return {
    name: p.get('issuer') || issuerFromLabel || account,
    account: account || '',
    secret: p.get('secret') || '',
    digits: p.get('digits') || undefined,
    period: p.get('period') || undefined,
    algorithm: p.get('algorithm') || undefined
  };
}

function normalizeTotp(item, where, problems) {
  if (!isMap(item)) {
    problems.push(`${where}: 「キー: 値」の形にしてください`);
    return null;
  }
  checkKeys(item, ['name', 'account', 'secret', 'uri', 'digits', 'period', 'algorithm'], where, problems);
  const fromUri = item.uri ? parseOtpauth(str(item.uri), where, problems) : {};
  const merged = { ...fromUri, ...Object.fromEntries(Object.entries(item).filter(([k]) => k !== 'uri')) };
  const secret = str(merged.secret).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!secret) problems.push(`${where}.secret: シード（base32）か uri が必要です`);
  else {
    try {
      const bytes = core.base32Decode(secret);
      if (bytes.length < 10) problems.push(`${where}.secret: シードが短すぎます（${bytes.length} バイト）`);
    } catch (e) {
      problems.push(`${where}.secret: ${e.message}`);
    }
  }
  const algorithm = str(merged.algorithm || 'SHA1').toUpperCase();
  try {
    core.hashName(algorithm);
  } catch {
    problems.push(`${where}.algorithm: SHA1 / SHA256 / SHA512 のどれかにしてください`);
  }
  return {
    name: needString(merged.name, `${where}.name`, problems),
    account: str(merged.account),
    secret,
    digits: parseInt10(merged.digits, 6, problems, `${where}.digits`, 6, 8),
    period: parseInt10(merged.period, 30, problems, `${where}.period`, 10, 300),
    algorithm
  };
}

function normalizeField(f, where, problems) {
  if (!isMap(f)) {
    problems.push(`${where}: 「キー: 値」の形にしてください`);
    return null;
  }
  checkKeys(f, ['label', 'value', 'secret', 'type', 'big'], where, problems);
  const type = str(f.type || 'text');
  if (!FIELD_TYPES.includes(type)) problems.push(`${where}.type: ${FIELD_TYPES.join(' / ')} のどれかにしてください`);
  return {
    label: str(f.label),
    value: needString(f.value, `${where}.value`, problems),
    secret: parseBool(f.secret, false),
    type: FIELD_TYPES.includes(type) ? type : 'text',
    big: parseBool(f.big, false)
  };
}

function normalizeItem(type, item, where, problems) {
  switch (type) {
    case 'steps':
    case 'list':
      return needString(item, where, problems);
    case 'contacts': {
      if (!isMap(item)) {
        problems.push(`${where}: 「キー: 値」の形にしてください`);
        return null;
      }
      checkKeys(item, ['label', 'name', 'tel', 'note'], where, problems);
      return { label: str(item.label), name: needString(item.name, `${where}.name`, problems), tel: str(item.tel), note: str(item.note) };
    }
    case 'totp':
      return normalizeTotp(item, where, problems);
    case 'codes': {
      if (!isMap(item)) {
        problems.push(`${where}: 「キー: 値」の形にしてください`);
        return null;
      }
      checkKeys(item, ['name', 'note', 'codes'], where, problems);
      return { name: needString(item.name, `${where}.name`, problems), note: str(item.note), codes: stringList(item.codes, `${where}.codes`, problems) };
    }
    case 'entries': {
      if (!isMap(item)) {
        problems.push(`${where}: 「キー: 値」の形にしてください`);
        return null;
      }
      checkKeys(item, ['name', 'sub', 'note', 'fields'], where, problems);
      const fields = Array.isArray(item.fields) ? item.fields : [];
      if (!Array.isArray(item.fields)) problems.push(`${where}.fields: リストにしてください`);
      return {
        name: needString(item.name, `${where}.name`, problems),
        sub: str(item.sub),
        note: str(item.note),
        fields: fields.map((f, i) => normalizeField(f, `${where}.fields[${i}]`, problems)).filter(Boolean)
      };
    }
    default:
      return null;
  }
}

function normalizeBlock(block, where, problems) {
  if (!isMap(block)) {
    problems.push(`${where}: 「キー: 値」の形にしてください`);
    return null;
  }
  let type;
  let body;
  if ('type' in block) {
    type = str(block.type);
    body = block;
  } else {
    const keys = Object.keys(block);
    if (keys.length === 1 && BLOCK_TYPES.includes(keys[0])) {
      type = keys[0];
      body = TEXT_BLOCKS.includes(type) ? { text: block[type] } : ITEM_BLOCKS.includes(type) ? { items: block[type] } : block[type];
      if (!isMap(body)) {
        problems.push(`${where}: ${type} は「type: ${type}」の形で書いてください`);
        return null;
      }
    } else {
      problems.push(`${where}: type が必要です（${BLOCK_TYPES.join(' / ')}）`);
      return null;
    }
  }
  if (!BLOCK_TYPES.includes(type)) {
    problems.push(`${where}.type: 知らない種類です「${type}」（${BLOCK_TYPES.join(' / ')}）`);
    return null;
  }

  if (TEXT_BLOCKS.includes(type)) {
    return { type, text: needString(body.text, `${where}.text`, problems) };
  }
  if (type === 'secret') {
    checkKeys(body, ['type', 'name', 'text', 'note'], where, problems);
    return { type, name: needString(body.name, `${where}.name`, problems), text: needString(body.text, `${where}.text`, problems), note: str(body.note) };
  }
  checkKeys(body, ['type', 'items', 'title', 'ordered'], where, problems);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    problems.push(`${where}.items: 1 つ以上のリストにしてください`);
    return null;
  }
  const items = body.items.map((it, i) => normalizeItem(type, it, `${where}.items[${i}]`, problems)).filter((x) => x !== null);
  const out = { type, items, title: str(body.title) };
  if (type === 'list') out.ordered = parseBool(body.ordered, false);
  return out;
}

function normalizeSections(raw, problems) {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('sections: 1 つ以上の章を書いてください');
    return [];
  }
  const ids = new Set();
  return raw
    .map((sec, i) => {
      const where = `sections[${i}]`;
      if (!isMap(sec)) {
        problems.push(`${where}: 「キー: 値」の形にしてください`);
        return null;
      }
      checkKeys(sec, ['id', 'title', 'subtitle', 'size', 'tone', 'emphasis', 'blocks'], where, problems);
      const id = str(sec.id);
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) problems.push(`${where}.id: 半角英小文字・数字・-・_ で付けてください（今: ${id || '空'}）`);
      else if (ids.has(id)) problems.push(`${where}.id: 「${id}」が重複しています`);
      ids.add(id);
      const size = str(sec.size || 'half');
      if (!['half', 'full'].includes(size)) problems.push(`${where}.size: half か full にしてください`);
      const tone = str(sec.tone || 'accent');
      if (!['accent', 'warn'].includes(tone)) problems.push(`${where}.tone: accent か warn にしてください`);
      if (!Array.isArray(sec.blocks) || sec.blocks.length === 0) {
        problems.push(`${where}.blocks: 1 つ以上のブロックを書いてください`);
      }
      const blocks = (Array.isArray(sec.blocks) ? sec.blocks : [])
        .map((b, j) => normalizeBlock(b, `${where}.blocks[${j}]`, problems))
        .filter(Boolean);
      return {
        id,
        title: needString(sec.title, `${where}.title`, problems),
        subtitle: str(sec.subtitle),
        size: size === 'full' ? 'full' : 'half',
        tone: tone === 'warn' ? 'warn' : 'accent',
        emphasis: parseBool(sec.emphasis, false),
        blocks
      };
    })
    .filter(Boolean);
}

export function parseConfig(text) {
  let doc;
  try {
    doc = YAML.parse(text, { schema: 'failsafe', prettyErrors: true });
  } catch (e) {
    throw new ConfigError([`YAML として読めません: ${e.message}`]);
  }
  if (!isMap(doc)) throw new ConfigError(['ファイルの一番外側は「キー: 値」の形にしてください']);
  const problems = [];
  for (const k of Object.keys(doc)) if (!['site', 'kdf', 'sections'].includes(k)) problems.push(`${k}: 知らない項目です（site / kdf / sections）`);
  const site = normalizeSite(doc.site, problems);
  const kdf = normalizeKdf(doc.kdf, problems);
  const sections = normalizeSections(doc.sections, problems);

  // 章内リンク [文字](#id) の行き先チェック
  const ids = new Set(sections.map((s) => s.id));
  const visit = (v, where) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\[[^\]]*\]\(#([^)]+)\)/g)) {
        if (!ids.has(m[1])) problems.push(`${where}: リンク先の章「#${m[1]}」がありません`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${where}[${i}]`));
    else if (isMap(v)) for (const [k, x] of Object.entries(v)) visit(x, `${where}.${k}`);
  };
  sections.forEach((s, i) => visit(s.blocks, `sections[${i}].blocks`));

  if (problems.length) throw new ConfigError(problems);
  return { site, kdf, data: { sections } };
}

// 非公開側に含まれる文字列を集める（公開側へ漏れていないかの確認用）
// 値の中の文字列をすべて集める（漏洩チェック用）
export function allStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

export function privateStrings(data, minLength = 6) {
  const out = new Set();
  const visit = (v) => {
    if (typeof v === 'string') {
      for (const line of v.split('\n')) {
        const s = line.trim();
        if (s.length >= minLength) out.add(s);
      }
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isMap(v)) Object.values(v).forEach(visit);
  };
  visit(data);
  return [...out];
}
