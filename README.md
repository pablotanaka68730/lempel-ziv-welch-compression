# LZW Compression

A small, dependency-free Lempel-Ziv-Welch compressor and decompressor for JavaScript strings. `compress(text)` returns a `Uint8Array` of little-endian Int32 codes terminated by `-1`; `decompress(bytes)` reverses it.

```js
import { compress, decompress } from './src/index.js';

const bytes = compress('the quick brown fox jumps over the lazy dog');
const text  = decompress(bytes);
// text === 'the quick brown fox jumps over the lazy dog'
```

## Why this exists

LZW is a fast, dictionary-based scheme that shines when the input contains repeated substrings: each repeat becomes a single integer code. This library is a deliberately small, correct implementation suitable for embedded bundling, deterministic round-tripping, and teaching. The trade-off it makes is simplicity over compactness: codes are emitted as 32-bit little-endian integers rather than a variable-bit-width stream, so the output is larger than a bit-packed LZW would produce. Four bytes per token is the cost of code that fits in one screen and never has to reason about bit alignment.

## Edge cases worth knowing

The dictionary is seeded with all 65536 UTF-16 code units, so any JavaScript string round-trips, including lone surrogate halves (which UTF-8 conversion would silently corrupt into U+FFFD). Supplementary-plane characters such as emoji are carried as their surrogate pair rather than a single code point; they still round-trip exactly. Compression only begins to pay off once repeated substrings appear — a single short ASCII word may expand slightly because of the four-byte per-token overhead and the one-word terminator.
