// TOTP (RFC 6238) — gera código de 6 dígitos a partir de secret base32.
// Aceita também otpauth:// URIs (extrai o secret).

const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  const s = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of s) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function extractSecret(input) {
  if (!input) return '';
  if (input.startsWith('otpauth://')) {
    const m = input.match(/[?&]secret=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }
  return input;
}

function generate(secretInput, time = Date.now(), period = 30, digits = 6) {
  const secret = extractSecret(secretInput);
  if (!secret) return '';
  const counter = Math.floor(time / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
            | (hmac[offset + 1] << 16)
            | (hmac[offset + 2] << 8)
            |  hmac[offset + 3];
  const code = bin % Math.pow(10, digits);
  return String(code).padStart(digits, '0');
}

function secondsRemaining(period = 30) {
  return period - Math.floor((Date.now() / 1000) % period);
}

module.exports = { generate, extractSecret, secondsRemaining };
