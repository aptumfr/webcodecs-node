/**
 * Hardware pipeline type definitions
 */

export type HardwareType = 'cuda' | 'vaapi' | 'qsv' | 'videotoolbox' | 'drm' | 'v4l2m2m' | 'software';

/**
 * Hardware capabilities for format conversion
 */
export interface HardwareFormatCapabilities {
  // Scale filter name for this hardware (e.g., 'scale_cuda', 'scale_vaapi')
  scaleFilter: string;
  // Formats that can be produced directly on GPU before download
  gpuOutputFormats: string[];
  // Whether this hardware supports direct RGBA/BGRA output
  supportsRgbOutput: boolean;
}
