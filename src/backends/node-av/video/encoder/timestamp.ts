/**
 * Timestamp conversion utilities for video encoding
 *
 * Handles conversion between WebCodecs microsecond timestamps
 * and FFmpeg encoder timebases.
 */

/**
 * Rational-like interface compatible with both Rational class and IRational
 */
export interface RationalLike {
  num: number;
  den: number;
}

/**
 * Convert input timestamp (microseconds) to encoder PTS
 *
 * For most codecs, timebase is 1/1000000 so pts = timestamp
 * For AV1/SVT-AV1, timebase is 1/framerate so pts = timestamp * framerate / 1000000
 */
export function microsecondsToPts(timestampUs: number, timeBase: RationalLike): bigint {
  return BigInt(Math.round(timestampUs * timeBase.den / 1_000_000));
}

/**
 * Convert packet PTS to microseconds
 *
 * timestamp_us = pts * (timeBase.num / timeBase.den) * 1_000_000
 */
export function ptsToMicroseconds(pts: bigint, timeBase: RationalLike): number {
  const ptsUs = (pts * BigInt(timeBase.num) * 1_000_000n) / BigInt(timeBase.den);
  return Number(ptsUs);
}

/**
 * Get the appropriate timebase for a codec
 *
 * Most codecs use microsecond timebase (1/1000000)
 * SVT-AV1 requires framerate-based timebase to avoid "maximum 240 fps" error
 */
export function getCodecTimeBase<T extends RationalLike>(
  codecName: string,
  framerate: number,
  RationalClass: new (num: number, den: number) => T
): T {
  if (codecName === 'av1') {
    // SVT-AV1 derives framerate from timebase
    return new RationalClass(1, framerate);
  }
  // Use microsecond timebase to preserve input timestamps exactly
  return new RationalClass(1, 1_000_000);
}
