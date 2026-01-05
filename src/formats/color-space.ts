/**
 * Color space conversion utilities
 * Provides YUV <-> RGB conversions with support for BT.601, BT.709, and BT.2020 matrices
 */

export type ColorMatrix = 'bt601' | 'bt709' | 'bt2020' | 'smpte170m' | 'bt470bg';

/**
 * YUV to RGB conversion coefficients for different standards
 * These are the inverse matrix coefficients for video range
 */
const YUV_TO_RGB_COEFFICIENTS: Record<ColorMatrix, { kr: number; kb: number }> = {
  // BT.601 / SMPTE 170M (SD video)
  bt601: { kr: 0.299, kb: 0.114 },
  smpte170m: { kr: 0.299, kb: 0.114 },
  bt470bg: { kr: 0.299, kb: 0.114 },
  // BT.709 (HD video)
  bt709: { kr: 0.2126, kb: 0.0722 },
  // BT.2020 (UHD/HDR video)
  bt2020: { kr: 0.2627, kb: 0.0593 },
};

/**
 * Get color matrix from VideoColorSpaceInit
 */
export function getColorMatrix(matrix?: string | null): ColorMatrix {
  switch (matrix) {
    case 'bt601':
    case 'smpte170m':
    case 'bt470bg':
      return 'bt601';
    case 'bt2020-ncl':
    case 'bt2020':
      return 'bt2020';
    case 'bt709':
    case 'rgb':
    default:
      return 'bt709';
  }
}

/**
 * Convert RGBA pixel to YUV
 * @param matrix Color matrix to use (default: bt709)
 * @returns [Y, U, V] values in range 0-255
 */
export function rgbaToYuv(
  r: number,
  g: number,
  b: number,
  matrix: ColorMatrix = 'bt709'
): [number, number, number] {
  const { kr, kb } = YUV_TO_RGB_COEFFICIENTS[matrix];
  const kg = 1 - kr - kb;

  const y = kr * r + kg * g + kb * b;
  const u = (b - y) / (2 * (1 - kb)) + 128;
  const v = (r - y) / (2 * (1 - kr)) + 128;

  return [
    Math.max(0, Math.min(255, Math.round(y))),
    Math.max(0, Math.min(255, Math.round(u))),
    Math.max(0, Math.min(255, Math.round(v))),
  ];
}

/**
 * Convert YUV to RGBA
 * @param matrix Color matrix to use (default: bt709)
 * @returns [R, G, B, A] values in range 0-255
 */
export function yuvToRgba(
  y: number,
  u: number,
  v: number,
  matrix: ColorMatrix = 'bt709'
): [number, number, number, number] {
  const { kr, kb } = YUV_TO_RGB_COEFFICIENTS[matrix];
  const kg = 1 - kr - kb;

  const c = y;
  const d = u - 128;
  const e = v - 128;

  // Inverse matrix coefficients
  const r = c + (2 * (1 - kr)) * e;
  const g = c - (2 * kb * (1 - kb) / kg) * d - (2 * kr * (1 - kr) / kg) * e;
  const b = c + (2 * (1 - kb)) * d;

  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
    255,
  ];
}

/**
 * SMPTE ST 2086 Mastering Display Metadata
 * Describes the color volume of the mastering display
 */
export interface SmpteSt2086Metadata {
  /**
   * CIE 1931 xy chromaticity coordinates of the display primaries
   * Values are in range [0, 1] with 0.00002 precision
   */
  primaryRChromaticityX: number;
  primaryRChromaticityY: number;
  primaryGChromaticityX: number;
  primaryGChromaticityY: number;
  primaryBChromaticityX: number;
  primaryBChromaticityY: number;

  /**
   * CIE 1931 xy chromaticity coordinates of the white point
   */
  whitePointChromaticityX: number;
  whitePointChromaticityY: number;

  /**
   * Maximum luminance of the display in cd/m² (nits)
   */
  maxLuminance: number;

  /**
   * Minimum luminance of the display in cd/m² (nits)
   */
  minLuminance: number;
}

/**
 * Content Light Level Information
 * Describes the light level of the content itself
 */
export interface ContentLightLevelInfo {
  /**
   * Maximum Content Light Level in cd/m² (nits)
   * The maximum light level of any single pixel in the content
   */
  maxCLL: number;

  /**
   * Maximum Frame-Average Light Level in cd/m² (nits)
   * The maximum average light level of any frame in the content
   */
  maxFALL: number;
}

/**
 * HDR Metadata combining mastering display and content light level info
 */
export interface HdrMetadata {
  /**
   * SMPTE ST 2086 mastering display metadata
   */
  smpteSt2086?: SmpteSt2086Metadata;

  /**
   * Content light level information
   */
  contentLightLevel?: ContentLightLevelInfo;
}

/**
 * Video color space initialization options
 */
export interface VideoColorSpaceInit {
  primaries?: 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'smpte432';
  transfer?: 'bt709' | 'smpte170m' | 'iec61966-2-1' | 'linear' | 'pq' | 'hlg';
  matrix?: 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl';
  fullRange?: boolean;
  /**
   * HDR metadata (SMPTE ST 2086 and/or Content Light Level)
   * Only meaningful when transfer is 'pq' or 'hlg'
   */
  hdrMetadata?: HdrMetadata;
}

/**
 * VideoColorSpace - describes the color space of video content
 */
export class VideoColorSpace {
  readonly primaries: string | null;
  readonly transfer: string | null;
  readonly matrix: string | null;
  readonly fullRange: boolean | null;
  readonly hdrMetadata: HdrMetadata | null;

  constructor(init?: VideoColorSpaceInit) {
    this.primaries = init?.primaries ?? null;
    this.transfer = init?.transfer ?? null;
    this.matrix = init?.matrix ?? null;
    this.fullRange = init?.fullRange ?? null;
    this.hdrMetadata = init?.hdrMetadata ?? null;
  }

  /**
   * Check if this color space represents HDR content
   */
  get isHdr(): boolean {
    return this.transfer === 'pq' || this.transfer === 'hlg';
  }

  /**
   * Check if HDR metadata is available
   */
  get hasHdrMetadata(): boolean {
    return this.hdrMetadata !== null && (
      this.hdrMetadata.smpteSt2086 !== undefined ||
      this.hdrMetadata.contentLightLevel !== undefined
    );
  }

  toJSON(): {
    primaries: string | null;
    transfer: string | null;
    matrix: string | null;
    fullRange: boolean | null;
  } {
    return {
      primaries: this.primaries,
      transfer: this.transfer,
      matrix: this.matrix,
      fullRange: this.fullRange,
    };
  }
}

/**
 * Common HDR10 display primaries (DCI-P3 D65)
 */
export const HDR10_DISPLAY_PRIMARIES: Pick<
  SmpteSt2086Metadata,
  'primaryRChromaticityX' | 'primaryRChromaticityY' |
  'primaryGChromaticityX' | 'primaryGChromaticityY' |
  'primaryBChromaticityX' | 'primaryBChromaticityY' |
  'whitePointChromaticityX' | 'whitePointChromaticityY'
> = {
  // BT.2020 / Rec. 2020 primaries
  primaryRChromaticityX: 0.708,
  primaryRChromaticityY: 0.292,
  primaryGChromaticityX: 0.170,
  primaryGChromaticityY: 0.797,
  primaryBChromaticityX: 0.131,
  primaryBChromaticityY: 0.046,
  // D65 white point
  whitePointChromaticityX: 0.3127,
  whitePointChromaticityY: 0.3290,
};

/**
 * Create a typical HDR10 mastering display metadata
 * @param maxLuminance Maximum luminance in nits (typical: 1000-10000)
 * @param minLuminance Minimum luminance in nits (typical: 0.0001-0.05)
 */
export function createHdr10MasteringMetadata(
  maxLuminance: number,
  minLuminance: number = 0.0001
): SmpteSt2086Metadata {
  return {
    ...HDR10_DISPLAY_PRIMARIES,
    maxLuminance,
    minLuminance,
  };
}

/**
 * Create content light level info
 * @param maxCLL Maximum Content Light Level in nits
 * @param maxFALL Maximum Frame-Average Light Level in nits
 */
export function createContentLightLevel(
  maxCLL: number,
  maxFALL: number
): ContentLightLevelInfo {
  return { maxCLL, maxFALL };
}

/**
 * FFmpeg AVColorPrimaries enum values
 * Maps to VideoColorSpaceInit.primaries
 */
const AVCOL_PRI_VALUES = {
  RESERVED0: 0,
  BT709: 1,
  UNSPECIFIED: 2,
  RESERVED: 3,
  BT470M: 4,
  BT470BG: 5,
  SMPTE170M: 6,
  SMPTE240M: 7,
  FILM: 8,
  BT2020: 9,
  SMPTE428: 10,
  SMPTE431: 11,
  SMPTE432: 12,
} as const;

/**
 * FFmpeg AVColorTransferCharacteristic enum values
 * Maps to VideoColorSpaceInit.transfer
 */
const AVCOL_TRC_VALUES = {
  RESERVED0: 0,
  BT709: 1,
  UNSPECIFIED: 2,
  RESERVED: 3,
  GAMMA22: 4,
  GAMMA28: 5,
  SMPTE170M: 6,
  SMPTE240M: 7,
  LINEAR: 8,
  LOG: 9,
  LOG_SQRT: 10,
  IEC61966_2_4: 11,
  BT1361_ECG: 12,
  IEC61966_2_1: 13, // sRGB
  BT2020_10: 14,
  BT2020_12: 15,
  SMPTE2084: 16, // PQ / HDR10
  SMPTE428: 17,
  ARIB_STD_B67: 18, // HLG
} as const;

/**
 * FFmpeg AVColorSpace enum values (matrix coefficients)
 * Maps to VideoColorSpaceInit.matrix
 */
const AVCOL_SPC_VALUES = {
  RGB: 0,
  BT709: 1,
  UNSPECIFIED: 2,
  RESERVED: 3,
  FCC: 4,
  BT470BG: 5,
  SMPTE170M: 6,
  SMPTE240M: 7,
  YCGCO: 8,
  BT2020_NCL: 9,
  BT2020_CL: 10,
} as const;

/**
 * FFmpeg AVColorRange enum values
 * Maps to VideoColorSpaceInit.fullRange
 */
const AVCOL_RANGE_VALUES = {
  UNSPECIFIED: 0,
  MPEG: 1, // Limited range (16-235 for Y, 16-240 for UV)
  JPEG: 2, // Full range (0-255)
} as const;

/**
 * Convert FFmpeg AVColorPrimaries to WebCodecs primaries string
 */
export function avColorPrimariesToWebCodecs(primaries: number): VideoColorSpaceInit['primaries'] | undefined {
  switch (primaries) {
    case AVCOL_PRI_VALUES.BT709:
      return 'bt709';
    case AVCOL_PRI_VALUES.BT470BG:
      return 'bt470bg';
    case AVCOL_PRI_VALUES.SMPTE170M:
    case AVCOL_PRI_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_PRI_VALUES.BT2020:
      return 'bt2020';
    case AVCOL_PRI_VALUES.SMPTE432:
      return 'smpte432';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorTransferCharacteristic to WebCodecs transfer string
 */
export function avColorTransferToWebCodecs(transfer: number): VideoColorSpaceInit['transfer'] | undefined {
  switch (transfer) {
    case AVCOL_TRC_VALUES.BT709:
    case AVCOL_TRC_VALUES.BT2020_10:
    case AVCOL_TRC_VALUES.BT2020_12:
      return 'bt709';
    case AVCOL_TRC_VALUES.SMPTE170M:
    case AVCOL_TRC_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_TRC_VALUES.IEC61966_2_1: // sRGB
      return 'iec61966-2-1';
    case AVCOL_TRC_VALUES.LINEAR:
      return 'linear';
    case AVCOL_TRC_VALUES.SMPTE2084: // PQ / HDR10
      return 'pq';
    case AVCOL_TRC_VALUES.ARIB_STD_B67: // HLG
      return 'hlg';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorSpace (matrix) to WebCodecs matrix string
 */
export function avColorSpaceToWebCodecs(colorSpace: number): VideoColorSpaceInit['matrix'] | undefined {
  switch (colorSpace) {
    case AVCOL_SPC_VALUES.RGB:
      return 'rgb';
    case AVCOL_SPC_VALUES.BT709:
      return 'bt709';
    case AVCOL_SPC_VALUES.BT470BG:
      return 'bt470bg';
    case AVCOL_SPC_VALUES.SMPTE170M:
    case AVCOL_SPC_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_SPC_VALUES.BT2020_NCL:
    case AVCOL_SPC_VALUES.BT2020_CL:
      return 'bt2020-ncl';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorRange to WebCodecs fullRange boolean
 */
export function avColorRangeToWebCodecs(range: number): boolean | undefined {
  switch (range) {
    case AVCOL_RANGE_VALUES.JPEG:
      return true;
    case AVCOL_RANGE_VALUES.MPEG:
      return false;
    default:
      return undefined;
  }
}

/**
 * Extract VideoColorSpaceInit from FFmpeg frame color properties
 * Returns undefined for properties that are unspecified
 */
export function extractColorSpaceFromFrame(frame: {
  colorPrimaries?: number;
  colorTrc?: number;
  colorSpace?: number;
  colorRange?: number;
}): VideoColorSpaceInit | undefined {
  const primaries = frame.colorPrimaries !== undefined
    ? avColorPrimariesToWebCodecs(frame.colorPrimaries)
    : undefined;
  const transfer = frame.colorTrc !== undefined
    ? avColorTransferToWebCodecs(frame.colorTrc)
    : undefined;
  const matrix = frame.colorSpace !== undefined
    ? avColorSpaceToWebCodecs(frame.colorSpace)
    : undefined;
  const fullRange = frame.colorRange !== undefined
    ? avColorRangeToWebCodecs(frame.colorRange)
    : undefined;

  // If all properties are undefined, return undefined
  if (primaries === undefined && transfer === undefined &&
      matrix === undefined && fullRange === undefined) {
    return undefined;
  }

  // Return only defined properties
  const result: VideoColorSpaceInit = {};
  if (primaries !== undefined) result.primaries = primaries;
  if (transfer !== undefined) result.transfer = transfer;
  if (matrix !== undefined) result.matrix = matrix;
  if (fullRange !== undefined) result.fullRange = fullRange;

  return result;
}
