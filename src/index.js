import { compress, decompress } from './core.js';

/**
 * Public entry point for the LZW library.
 *
 * Only the two top-level functions are re-exported because they cover
 * everything a caller needs; exposing internal helpers would only
 * invite coupling to implementation details that may change.
 */
export { compress, decompress };
