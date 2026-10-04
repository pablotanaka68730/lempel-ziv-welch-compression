/**
 * Lempel-Ziv-Welch compression for JavaScript strings.
 *
 * Implementation notes and the one interpretation this library picks:
 *
 * - Codes are emitted as 32-bit signed integers and encoded as little-endian
 *   Int32 in the byte output. Two's complement means -1 reads back as -1,
 *   so the terminator is self-framing and cannot collide with a real code.
 * - The dictionary is seeded with every code unit from 0 to 65535, so any
 *   UTF-16 string round-trips. Surrogate halves are supported because
 *   String.prototype codePointAt / iterating code points would split lone
 *   surrogates into U+FFFD and silently corrupt input. Working on code units
 *   preserves them verbatim.
 * - 12-bit LZW (the classic GIF ceiling) caps the table at 4096 entries and
 *   starts failing on inputs that need a larger alphabet; 32-bit codes cost
 *   four bytes per token but keep the implementation simple and correct for
 *   arbitrary text. That is the trade-off documented in the README.
 * - Decompression reuses the encoder's dictionary-growing schedule so the
 *   two sides never desync. The one well-known special case — a token whose
 *   entry has not been seen yet because it was just added on the encode side —
 *   is handled explicitly below.
 * - Only the BMP code units 0..65535 are seeded. Supplementary-plane
 *   characters are represented as their surrogate pair and round-trip
 *   correctly; they are just carried as two code units rather than one.
 */

const TERMINATOR = -1;
const MAX_CODE = 0x7fffffff; // Largest positive signed Int32.

/**
 * Compress a string into a Uint8Array of little-endian Int32 codes.
 *
 * @param {string} input - The string to compress. Must be a string; pass
 *   String(x) first if your data is not already a string.
 * @returns {Uint8Array} Little-endian Int32 stream: one word per emitted code,
 *   terminated by -1 so decompress knows where the stream ends.
 */
export function compress(input) {
  if (typeof input !== 'string') {
    throw new TypeError('compress expects a string');
  }

  // Output buffer: worst case every code unit becomes its own token plus the
  // terminator. Grown in chunks rather than reallocating per push.
  const out = [];

  // Seed the table with every possible 16-bit code unit. Using a plain object
  // keeps lookups O(1) without a Map's per-entry overhead for 65k initial keys.
  const table = Object.create(null);
  let nextCode = 0;
  for (let i = 0; i <= 0xffff; i++) {
    table[String.fromCharCode(i)] = nextCode++;
  }

  if (input.length === 0) {
    out.push(TERMINATOR);
    return pack(out);
  }

  let w = input.charAt(0);
  for (let i = 1; i < input.length; i++) {
    const c = input.charAt(i);
    const wc = w + c;
    if (wc in table) {
      w = wc;
    } else {
      out.push(table[w]);
      if (nextCode <= MAX_CODE) {
        table[wc] = nextCode++;
      }
      // If the table is full we stop growing it; remaining input is still
      // emitted using the existing codes, matching canonical LZW behaviour.
      w = c;
    }
  }
  out.push(table[w]);
  out.push(TERMINATOR);

  return pack(out);
}

/**
 * Decompress a Uint8Array produced by compress back into the original string.
 *
 * @param {Uint8Array} bytes - Little-endian Int32 stream terminated by -1.
 * @returns {string} The original string.
 */
export function decompress(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('decompress expects a Uint8Array');
  }

  const codes = unpack(bytes);
  if (codes.length === 0 || codes[codes.length - 1] !== TERMINATOR) {
    throw new Error('LZW stream is missing its terminator');
  }

  // Strip the terminator; it served only to frame the stream.
  const tokens = codes.slice(0, -1);

  // Inverse of the encoder's seed: indices 0..65535 map back to code units.
  const dict = new Array(MAX_CODE + 1);
  let nextCode = 0;
  for (let i = 0; i <= 0xffff; i++) {
    dict[nextCode++] = String.fromCharCode(i);
  }

  if (tokens.length === 0) {
    return '';
  }

  // String concatenation in a hot loop is O(n^2) for very large inputs.
  // Pushing fragments into an array and joining once at the end is the
  // standard V8-friendly workaround and keeps memory churn low.
  const pieces = [];

  const first = tokens[0];
  if (first < 0 || first >= nextCode) {
    throw new Error('LZW stream begins with an out-of-range code');
  }
  let prev = dict[first];
  pieces.push(prev);

  for (let i = 1; i < tokens.length; i++) {
    const code = tokens[i];
    let entry;

    if (code >= 0 && code < nextCode) {
      entry = dict[code];
    } else if (code === nextCode) {
      // The one LZW edge case: the decoder has not yet installed the entry
      // for `code` because the encoder only added it after emitting `code`.
      // At that moment the entry is provably `prev + prev.charAt(0)`.
      // Anything else means a corrupt stream.
      entry = prev + prev.charAt(0);
    } else {
      throw new Error(`LZW stream contains an out-of-range code: ${code}`);
    }

    pieces.push(entry);

    if (nextCode <= MAX_CODE) {
      dict[nextCode++] = prev + entry.charAt(0);
    }
    prev = entry;
  }

  return pieces.join('');
}

/**
 * Pack an array of signed 32-bit integers into a little-endian Uint8Array.
 *
 * A DataView would work, but a typed array of the right length allocated once
 * is both faster and avoids any byte-order questions on big-endian hosts.
 */
function pack(codes) {
  const out = new Uint8Array(codes.length * 4);
  let p = 0;
  for (let i = 0; i < codes.length; i++) {
    let v = codes[i] | 0; // Coerce to signed Int32.
    out[p++] = v & 0xff;
    out[p++] = (v >>> 8) & 0xff;
    out[p++] = (v >>> 16) & 0xff;
    out[p++] = (v >>> 24) & 0xff;
  }
  return out;
}

/**
 * Inverse of pack: read little-endian Int32 words until the terminator (-1).
 * A trailing partial word is rejected rather than silently truncated.
 */
function unpack(bytes) {
  if (bytes.length % 4 !== 0) {
    throw new Error('LZW byte stream length is not a multiple of 4');
  }
  const count = bytes.length / 4;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const lo = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
    const hi = bytes[p + 3];
    // OR the sign bit in, then coerce back to a signed Int32 with | 0.
    out[i] = ((hi << 24) | lo) | 0;
  }
  return out;
}
