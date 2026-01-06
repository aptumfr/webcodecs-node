/**
 * Audio codec string validation according to WebCodecs specification
 *
 * @see https://www.w3.org/TR/webcodecs-codec-registry/
 */

export interface AudioCodecValidationResult {
  valid: boolean;
  supported: boolean;
  error?: string;
}

/**
 * Validate an audio codec string according to WebCodecs spec
 *
 * Returns { valid: true, supported: true } for valid, supported codecs
 * Returns { valid: true, supported: false } for valid but unsupported codecs
 * Returns { valid: false, supported: false } for invalid codec strings
 */
export function validateAudioCodec(codec: string): AudioCodecValidationResult {
  // Check for whitespace (invalid)
  if (codec !== codec.trim()) {
    return { valid: true, supported: false, error: 'Codec string contains whitespace' };
  }

  // Check for MIME type format (invalid for WebCodecs)
  if (codec.includes('/') || codec.includes(';')) {
    return { valid: true, supported: false, error: 'MIME type format not accepted' };
  }

  // Opus: exactly "opus"
  if (codec === 'opus') {
    return { valid: true, supported: true };
  }

  // Opus with wrong casing
  if (codec.toLowerCase() === 'opus' && codec !== 'opus') {
    return { valid: true, supported: false, error: 'Opus codec must be lowercase "opus"' };
  }

  // AAC: mp4a.40.X format
  if (codec.startsWith('mp4a.')) {
    return validateAacCodec(codec);
  }

  // FLAC: exactly "flac"
  if (codec === 'flac') {
    return { valid: true, supported: true };
  }

  // FLAC with wrong casing
  if (codec.toLowerCase() === 'flac' && codec !== 'flac') {
    return { valid: true, supported: false, error: 'FLAC codec must be lowercase "flac"' };
  }

  // Vorbis: exactly "vorbis"
  if (codec === 'vorbis') {
    return { valid: true, supported: true };
  }

  // Vorbis with wrong casing
  if (codec.toLowerCase() === 'vorbis' && codec !== 'vorbis') {
    return { valid: true, supported: false, error: 'Vorbis codec must be lowercase "vorbis"' };
  }

  // MP3: exactly "mp3"
  if (codec === 'mp3') {
    return { valid: true, supported: true };
  }

  // MP3 with wrong casing
  if (codec.toLowerCase() === 'mp3' && codec !== 'mp3') {
    return { valid: true, supported: false, error: 'MP3 codec must be lowercase "mp3"' };
  }

  // PCM formats: pcm-u8, pcm-s16, pcm-s24, pcm-s32, pcm-f32
  if (codec.startsWith('pcm-')) {
    return validatePcmCodec(codec);
  }

  // Unknown codec
  return { valid: true, supported: false, error: `Unrecognized codec: ${codec}` };
}

/**
 * Validate AAC codec string
 * Format: mp4a.40.X where X is the audio object type
 * Common values: mp4a.40.2 (AAC-LC), mp4a.40.5 (HE-AAC), mp4a.40.29 (HE-AACv2)
 */
function validateAacCodec(codec: string): AudioCodecValidationResult {
  // mp4a.40.X format
  const match = codec.match(/^mp4a\.40\.(\d+)$/);
  if (!match) {
    // Check for mp4a.XX.Y format (other MPEG-4 audio)
    const otherMatch = codec.match(/^mp4a\.([0-9A-Fa-f]{2})\.(\d+)$/);
    if (otherMatch) {
      const objectTypeIndication = parseInt(otherMatch[1], 16);
      // 0x40 = MPEG-4 Audio, others may not be supported
      if (objectTypeIndication !== 0x40) {
        return { valid: true, supported: false, error: `Unsupported MPEG-4 audio type: 0x${objectTypeIndication.toString(16)}` };
      }
    }
    return { valid: true, supported: false, error: 'Invalid AAC codec format, expected mp4a.40.X' };
  }

  const audioObjectType = parseInt(match[1], 10);

  // Valid audio object types for AAC:
  // 1 = AAC Main, 2 = AAC-LC, 3 = AAC SSR, 4 = AAC LTP
  // 5 = SBR (HE-AAC), 29 = PS (HE-AACv2)
  // 23 = LD, 39 = ELD
  const validTypes = [1, 2, 3, 4, 5, 6, 17, 19, 20, 23, 29, 39, 42];
  if (!validTypes.includes(audioObjectType)) {
    return { valid: true, supported: false, error: `Unknown AAC audio object type: ${audioObjectType}` };
  }

  return { valid: true, supported: true };
}

/**
 * Validate PCM codec string
 * Format: pcm-{format} where format is u8, s16, s24, s32, or f32
 */
function validatePcmCodec(codec: string): AudioCodecValidationResult {
  const validFormats = ['pcm-u8', 'pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32'];

  if (validFormats.includes(codec)) {
    return { valid: true, supported: true };
  }

  // Check for valid format with wrong casing
  if (validFormats.includes(codec.toLowerCase())) {
    return { valid: true, supported: false, error: `PCM codec must be lowercase "${codec.toLowerCase()}"` };
  }

  return { valid: true, supported: false, error: `Unknown PCM format: ${codec}` };
}
