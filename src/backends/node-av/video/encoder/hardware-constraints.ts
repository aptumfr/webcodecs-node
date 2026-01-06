/**
 * Hardware encoder constraints and minimum resolution requirements
 */

/**
 * Get minimum resolution requirements for hardware encoders
 * These are known constraints from hardware encoder specifications
 */
export function getHardwareMinResolution(hwaccel: string, codec: string): { width: number; height: number } {
  // VAAPI constraints (Intel/AMD)
  if (hwaccel === 'vaapi') {
    if (codec === 'h264') return { width: 128, height: 128 };
    if (codec === 'hevc' || codec === 'h265') return { width: 130, height: 128 };
    if (codec === 'vp8' || codec === 'vp9') return { width: 128, height: 128 };
    if (codec === 'av1') return { width: 128, height: 128 };
  }
  // QSV constraints (Intel)
  if (hwaccel === 'qsv') {
    return { width: 128, height: 128 };
  }
  // NVENC typically supports smaller sizes
  if (hwaccel === 'nvenc') {
    return { width: 32, height: 32 };
  }
  // Default: no minimum constraint
  return { width: 1, height: 1 };
}
