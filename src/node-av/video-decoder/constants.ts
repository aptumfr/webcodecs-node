/**
 * Video decoder constants
 */

/** Maximum filter chain fallback attempts */
export const MAX_FILTER_CHAIN_ATTEMPTS = 10;

/**
 * Codecs to skip for hardware decoding.
 * Empty by default - hardware decoding is attempted for all codecs when requested.
 * Can be populated if specific codecs are known to fail on certain hardware.
 * Previously VP9/AV1 were skipped, but modern VAAPI/QSV support these well.
 */
export const SKIP_HARDWARE_CODECS: string[] = [];
