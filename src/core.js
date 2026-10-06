/*
 * 非常口 — 暗号と TOTP のコア
 *
 * このファイルはブラウザ（ビルド時に HTML へインライン）と Node（scripts/）の
 * 両方で「同じもの」を使う。片方だけ直すと復号できなくなるので、変更したら
 * 必ず `npm test` を通すこと。
 *
 * 依存: globalThis.hashwasm（hash-wasm の argon2id）、WebCrypto（crypto.subtle）
 *
 * 暗号の形式（v1）
 *   データ鍵（DEK, 256bit ランダム）で中身を AES-256-GCM 暗号化する。
 *   DEK は「鍵スロット」ごとに、合言葉から Argon2id で導いた鍵で包んで保存する。
 *   スロットは配列で持つ（今は合言葉の 1 つだけ）。
 */
(function (root) {
  'use strict';

  var FORMAT = 'hijouguchi-vault';
  var VERSION = 1;
  var AAD_DATA = 'hijouguchi/v1/data';
  var AAD_SLOT = 'hijouguchi/v1/slot';
  var DEFAULT_KDF = { alg: 'argon2id', m: 65536, t: 3, p: 1 }; // m は KiB（= 64 MiB）
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function subtle() {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error('WebCrypto が使えません（https か file:// で開いてください）');
    }
    return root.crypto.subtle;
  }

  /* ---------- base64 / 乱数 ---------- */

  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function unb64(str) {
    var s = atob(str);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function random(n) {
    var a = new Uint8Array(n);
    root.crypto.getRandomValues(a);
    return a;
  }

  /* ---------- 鍵導出と AES-GCM ---------- */

  // 改ざんされたページで極端な値を渡されても止まらないように、範囲を決めておく
  function checkKdf(kdf) {
    var ok = kdf && kdf.alg === 'argon2id' &&
      Number.isInteger(kdf.m) && kdf.m >= 1024 && kdf.m <= 1048576 &&
      Number.isInteger(kdf.t) && kdf.t >= 1 && kdf.t <= 20 &&
      Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 4;
    if (!ok) throw new Error('未対応の鍵導出パラメータです');
  }

  async function deriveKey(passphrase, salt, kdf) {
    checkKdf(kdf);
    if (!root.hashwasm || !root.hashwasm.argon2id) throw new Error('argon2id が読み込まれていません');
    var raw = await root.hashwasm.argon2id({
      password: String(passphrase).normalize('NFC'),
      salt: salt,
      parallelism: kdf.p,
      iterations: kdf.t,
      memorySize: kdf.m,
      hashLength: 32,
      outputType: 'binary'
    });
    return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function importDek(dek) {
    return subtle().importKey('raw', dek, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function aesEncrypt(key, iv, data, aad) {
    var ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad) }, key, data);
    return new Uint8Array(ct);
  }

  async function aesDecrypt(key, iv, data, aad) {
    var pt = await subtle().decrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad) }, key, data);
    return new Uint8Array(pt);
  }

  /* ---------- スロットと金庫 ---------- */

  function newDek() {
    return random(32);
  }

  async function makeSlot(passphrase, dek, kdf, label) {
    kdf = kdf || DEFAULT_KDF;
    var salt = random(16);
    var iv = random(12);
    var kek = await deriveKey(passphrase, salt, kdf);
    var wrapped = await aesEncrypt(kek, iv, dek, AAD_SLOT);
    return {
      label: label || 'passphrase',
      kdf: { alg: kdf.alg, m: kdf.m, t: kdf.t, p: kdf.p },
      salt: b64(salt),
      iv: b64(iv),
      key: b64(wrapped)
    };
  }

  function checkVault(vault) {
    if (!vault || vault.format !== FORMAT) throw new Error('非常口の暗号データではありません');
    if (vault.v !== VERSION) throw new Error('未対応のバージョンです: ' + vault.v);
    if (!Array.isArray(vault.slots) || vault.slots.length === 0) throw new Error('鍵スロットがありません');
  }

  async function tryUnwrap(slot, passphrase) {
    var kek = await deriveKey(passphrase, unb64(slot.salt), slot.kdf);
    try {
      return await aesDecrypt(kek, unb64(slot.iv), unb64(slot.key), AAD_SLOT);
    } catch (e) {
      return null; // 合言葉違い（GCM の認証失敗）
    }
  }

  // どれかのスロットが開けば DEK を返す。開かなければ null。
  async function openSlots(vault, passphrase, onTry) {
    checkVault(vault);
    for (var i = 0; i < vault.slots.length; i++) {
      if (onTry) onTry(i, vault.slots.length);
      var dek = await tryUnwrap(vault.slots[i], passphrase);
      if (dek) return dek;
    }
    return null;
  }

  async function seal(dek, slots, payload) {
    var iv = random(12);
    var key = await importDek(dek);
    var ct = await aesEncrypt(key, iv, enc.encode(JSON.stringify(payload)), AAD_DATA);
    return { format: FORMAT, v: VERSION, slots: slots, iv: b64(iv), data: b64(ct) };
  }

  async function openWithDek(vault, dek) {
    checkVault(vault);
    var key = await importDek(dek);
    var pt = await aesDecrypt(key, unb64(vault.iv), unb64(vault.data), AAD_DATA);
    return JSON.parse(dec.decode(pt));
  }

  // 合言葉で開く。失敗したら null。
  async function unlock(vault, passphrase, onTry) {
    var dek = await openSlots(vault, passphrase, onTry);
    if (!dek) return null;
    var payload = await openWithDek(vault, dek);
    return { dek: dek, payload: payload };
  }

  /* ---------- TOTP（RFC 6238） ---------- */

  function base32Decode(input) {
    var s = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
    var bits = 0;
    var val = 0;
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var idx = B32.indexOf(s[i]);
      if (idx < 0) throw new Error('base32 として不正な文字があります: ' + s[i]);
      val = ((val << 5) | idx) & 0xffff;
      bits += 5;
      if (bits >= 8) {
        out.push((val >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function hashName(algorithm) {
    var a = String(algorithm || 'SHA1').toUpperCase().replace(/^SHA-?/, '');
    if (a === '1' || a === '256' || a === '512') return 'SHA-' + a;
    throw new Error('未対応のハッシュ: ' + algorithm);
  }

  async function totp(secretBytes, opts, timeMs) {
    opts = opts || {};
    var period = opts.period || 30;
    var digits = opts.digits || 6;
    var counter = Math.floor(timeMs / 1000 / period);
    var msg = new Uint8Array(8);
    for (var i = 7; i >= 0; i--) {
      msg[i] = counter % 256;
      counter = Math.floor(counter / 256);
    }
    var key = await subtle().importKey('raw', secretBytes, { name: 'HMAC', hash: hashName(opts.algorithm) }, false, ['sign']);
    var mac = new Uint8Array(await subtle().sign('HMAC', key, msg));
    var off = mac[mac.length - 1] & 15;
    var bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % Math.pow(10, digits)).padStart(digits, '0');
  }

  root.HJGCore = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    DEFAULT_KDF: DEFAULT_KDF,
    b64: b64,
    unb64: unb64,
    random: random,
    newDek: newDek,
    makeSlot: makeSlot,
    openSlots: openSlots,
    seal: seal,
    openWithDek: openWithDek,
    unlock: unlock,
    base32Decode: base32Decode,
    hashName: hashName,
    totp: totp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
