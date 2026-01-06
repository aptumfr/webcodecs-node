/**
 * Pixel format type definitions
 */

export type VideoPixelFormat =
  | 'I420'
  | 'I420A'
  | 'I422'
  | 'I422A'
  | 'I444'
  | 'I444A'
  | 'NV12'
  | 'RGBA'
  | 'RGBX'
  | 'BGRA'
  | 'BGRX'
  // 10-bit formats (16-bit container with 10-bit data in upper bits)
  | 'I420P10'
  | 'I420AP10'
  | 'I422P10'
  | 'I422AP10'
  | 'I444P10'
  | 'I444AP10'
  | 'P010'
  // 12-bit formats (16-bit container with 12-bit data)
  | 'I420P12'
  | 'I420AP12'
  | 'I422P12'
  | 'I422AP12'
  | 'I444P12'
  | 'I444AP12';

/**
 * Information about a single plane in a pixel format
 */
export interface PlaneInfo {
  width: number;
  height: number;
  bytesPerPixel: number;
}
