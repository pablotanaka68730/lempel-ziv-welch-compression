import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compress, decompress } from '../src/index.js';

/**
 * Every test feeds compress output straight into decompress and checks that
 * the original string comes back unchanged. That is the contract this
 * library actually makes, so that is what we assert.
 */

function roundTrip(s) {
  return decompress(compress(s));
}

test('empty string round-trips', () => {
  assert.equal(roundTrip(''), '');
});

test('single character round-trips', () => {
  assert.equal(roundTrip('a'), 'a');
});

test('plain ASCII round-trips', () => {
  assert.equal(roundTrip('the quick brown fox jumps over the lazy dog'),
               'the quick brown fox jumps over the lazy dog');
});

test('repeated substrings are accepted', () => {
  // The motivating case for LZW: long runs compress and must still decode.
  const s = 'ababababababababababababababababababababababababab';
  assert.equal(roundTrip(s), s);
});

test('compression actually shrinks repetitive input', () => {
  // 1000 'a's should compress to far fewer bytes than the raw input.
  const input = 'a'.repeat(1000);
  const out = compress(input);
  assert.ok(out.length < input.length * 2,
            `expected ${out.length} bytes to be smaller than ${input.length * 2}`);
  assert.equal(decompress(out), input);
});

test('unicode BMP round-trips', () => {
  assert.equal(roundTrip('héllo—wörld—日本語'), 'héllo—wörld—日本語');
});

test('emoji (supplementary plane via surrogate pair) round-trips', () => {
  assert.equal(roundTrip('hello 🌍 world 🎉'), 'hello 🌍 world 🎉');
});

test('lone surrogate halves are preserved verbatim', () => {
  // The implementation works on UTF-16 code units, so an unpaired surrogate
  // must survive intact rather than being replaced with U+FFFD.
  const s = 'a\ud800b';
  assert.equal(roundTrip(s), s);
});

test('all 65536 BMP code units round-trip', () => {
  let s = '';
  for (let i = 0; i <= 0xffff; i++) {
    s += String.fromCharCode(i);
  }
  assert.equal(roundTrip(s), s);
});

test('compress rejects non-string input', () => {
  assert.throws(() => compress(42), TypeError);
  assert.throws(() => compress(null), TypeError);
});

(test('decompress rejects non-Uint8Array input'), () => {
  assert.throws(() => decompress([1, 2, 3, 4]), TypeError);
});

(test('decompress rejects a stream without a terminator'), () => {
  // Four zero bytes — a valid code 0, but no trailing -1 to end the stream.
  const bad = new Uint8Array([0, 0, 0, 0]);
  assert.throws(() => decompress(bad), /terminator/);
});

(test('decompress rejects a byte stream whose length is not a multiple of 4'), () => {
  assert.throws(() => decompress(new Uint8Array([0, 0, 0])), /multiple of 4/);
});
