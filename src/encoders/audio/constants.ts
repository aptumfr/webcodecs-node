/**
 * AudioEncoder constants
 */

export const DEFAULT_FLUSH_TIMEOUT = 30000;
export const MAX_QUEUE_SIZE = 100; // Prevent unbounded memory growth

/** Opus always encodes at 48kHz regardless of input */
export const OPUS_ENCODER_SAMPLE_RATE = 48000;
