/**
 * Software encoder name mappings
 */

/**
 * Get software encoder name for a codec
 */
export function getSoftwareEncoder(codecName: string): string {
  switch (codecName) {
    case 'h264': return 'libx264';
    case 'hevc': return 'libx265';
    case 'vp8': return 'libvpx';
    case 'vp9': return 'libvpx-vp9';
    case 'av1': return 'libsvtav1';
    default: return codecName;
  }
}
