/**
 * Cached codec string parsing utilities
 *
 * Codec strings are parsed frequently throughout the codebase.
 * Caching avoids repeated string operations for the same codec.
 */

// Cache for codec base extraction (e.g., 'avc1.42001E' -> 'avc1')
const codecBaseCache = new Map<string, string>();

// Cache for full codec parsing results
const codecParseCache = new Map<string, ParsedCodec>();

/**
 * Parsed codec information
 */
export interface ParsedCodec {
  /** Base codec identifier (e.g., 'avc1', 'hev1', 'vp09') */
  base: string;
  /** Normalized codec name (e.g., 'h264', 'hevc', 'vp9') */
  name: VideoCodecName | AudioCodecName | null;
  /** Original codec string */
  original: string;
  /** Whether this is a video codec */
  isVideo: boolean;
  /** Whether this is an audio codec */
  isAudio: boolean;
}

export type VideoCodecName = 'h264' | 'hevc' | 'vp8' | 'vp9' | 'av1';
export type AudioCodecName = 'aac' | 'opus' | 'mp3' | 'vorbis' | 'flac';

/**
 * Video codec base to name mapping
 */
const VIDEO_CODEC_MAP: Record<string, VideoCodecName> = {
  'avc1': 'h264',
  'avc3': 'h264',
  'h264': 'h264',
  'hvc1': 'hevc',
  'hev1': 'hevc',
  'hevc': 'hevc',
  'h265': 'hevc',
  'vp8': 'vp8',
  'vp9': 'vp9',
  'vp09': 'vp9',
  'av01': 'av1',
  'av1': 'av1',
};

/**
 * Audio codec base to name mapping
 */
const AUDIO_CODEC_MAP: Record<string, AudioCodecName> = {
  'mp4a': 'aac',
  'aac': 'aac',
  'opus': 'opus',
  'mp3': 'mp3',
  'vorbis': 'vorbis',
  'flac': 'flac',
};

/**
 * Get the base codec identifier from a codec string (cached)
 *
 * @example
 * getCodecBase('avc1.42001E') // 'avc1'
 * getCodecBase('vp09.00.10.08') // 'vp09'
 * getCodecBase('opus') // 'opus'
 */
export function getCodecBase(codec: string): string {
  let base = codecBaseCache.get(codec);
  if (base === undefined) {
    base = codec.split('.')[0].toLowerCase();
    codecBaseCache.set(codec, base);
  }
  return base;
}

/**
 * Parse a codec string and return structured information (cached)
 *
 * @example
 * parseCodec('avc1.42001E')
 * // { base: 'avc1', name: 'h264', original: 'avc1.42001E', isVideo: true, isAudio: false }
 */
export function parseCodec(codec: string): ParsedCodec {
  let parsed = codecParseCache.get(codec);
  if (parsed === undefined) {
    const base = getCodecBase(codec);
    const videoName = VIDEO_CODEC_MAP[base] ?? null;
    const audioName = AUDIO_CODEC_MAP[base] ?? null;

    parsed = {
      base,
      name: videoName ?? audioName,
      original: codec,
      isVideo: videoName !== null,
      isAudio: audioName !== null,
    };
    codecParseCache.set(codec, parsed);
  }
  return parsed;
}

/**
 * Get normalized video codec name from codec string (cached)
 *
 * @returns Normalized name or null if not a recognized video codec
 */
export function getVideoCodecName(codec: string): VideoCodecName | null {
  const parsed = parseCodec(codec);
  return parsed.isVideo ? (parsed.name as VideoCodecName) : null;
}

/**
 * Get normalized audio codec name from codec string (cached)
 *
 * @returns Normalized name or null if not a recognized audio codec
 */
export function getAudioCodecName(codec: string): AudioCodecName | null {
  const parsed = parseCodec(codec);
  return parsed.isAudio ? (parsed.name as AudioCodecName) : null;
}

/**
 * Check if a codec string represents a video codec
 */
export function isVideoCodec(codec: string): boolean {
  return parseCodec(codec).isVideo;
}

/**
 * Check if a codec string represents an audio codec
 */
export function isAudioCodec(codec: string): boolean {
  return parseCodec(codec).isAudio;
}

/**
 * Clear the codec caches (for testing)
 */
export function clearCodecCache(): void {
  codecBaseCache.clear();
  codecParseCache.clear();
}
