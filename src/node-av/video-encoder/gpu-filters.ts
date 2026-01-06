/**
 * GPU-accelerated filter chain builders for video encoding
 */

/**
 * Build GPU-accelerated filter chain for format conversion and optional rescaling
 * Returns null if no GPU filter is available for this hardware type
 */
export function buildGpuFilterChain(
  hwType: string,
  targetFormat: string,
  inputWidth: number | undefined,
  inputHeight: number | undefined,
  outputWidth: number,
  outputHeight: number
): string | null {
  const needsScale = inputWidth !== undefined && inputHeight !== undefined &&
    (inputWidth !== outputWidth || inputHeight !== outputHeight);
  const scaleParams = needsScale ? `w=${outputWidth}:h=${outputHeight}:` : '';

  // GPU filter chains: upload to GPU → scale on GPU (if needed) → convert format → keep on GPU for encoder
  switch (hwType) {
    case 'vaapi':
      return `format=nv12,hwupload,scale_vaapi=${scaleParams}format=${targetFormat}`;
    case 'cuda':
      return `format=nv12,hwupload_cuda,scale_cuda=${scaleParams}format=${targetFormat}`;
    case 'qsv':
      return `format=nv12,hwupload=extra_hw_frames=64,scale_qsv=${scaleParams}format=${targetFormat}`;
    case 'videotoolbox':
      return `format=nv12,hwupload,scale_vt=${scaleParams}format=${targetFormat}`;
    default:
      return null;
  }
}
