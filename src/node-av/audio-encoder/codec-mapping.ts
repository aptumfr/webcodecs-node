/**
 * Audio codec name mapping utilities
 */

/**
 * Get FFmpeg encoder name from WebCodecs codec string
 */
export function getEncoderName(codec: string): string {
  const codecLower = codec.toLowerCase();
  if (codecLower.startsWith('mp4a') || codecLower === 'aac') {
    return 'aac';
  } else if (codecLower === 'opus') {
    return 'libopus';
  } else if (codecLower === 'vorbis') {
    return 'libvorbis';
  } else if (codecLower === 'flac') {
    return 'flac';
  } else if (codecLower === 'mp3') {
    return 'libmp3lame';
  }
  return 'aac';
}

/**
 * Get FFmpeg encoder codec from WebCodecs codec string
 */
export function getEncoderCodec(codec: string): string {
  const codecBase = codec.split('.')[0].toLowerCase();

  switch (codecBase) {
    case 'opus':
      return 'libopus';
    case 'mp3':
      return 'libmp3lame';
    case 'flac':
      return 'flac';
    case 'mp4a':
    case 'aac':
      return 'aac';
    case 'vorbis':
      return 'libvorbis';
    case 'pcm-s16':
      return 'pcm_s16le';
    case 'pcm-s24':
      return 'pcm_s24le';
    case 'pcm-s32':
      return 'pcm_s32le';
    case 'pcm-u8':
      return 'pcm_u8';
    case 'ulaw':
      return 'pcm_mulaw';
    case 'alaw':
      return 'pcm_alaw';
    case 'pcm-f32':
      return 'pcm_f32le';
    default:
      return 'aac';
  }
}
