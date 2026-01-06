/**
 * Color space type definitions
 */

export type ColorMatrix = 'bt601' | 'bt709' | 'bt2020' | 'smpte170m' | 'bt470bg';

/**
 * SMPTE ST 2086 Mastering Display Metadata
 * Describes the color volume of the mastering display
 */
export interface SmpteSt2086Metadata {
  primaryRChromaticityX: number;
  primaryRChromaticityY: number;
  primaryGChromaticityX: number;
  primaryGChromaticityY: number;
  primaryBChromaticityX: number;
  primaryBChromaticityY: number;
  whitePointChromaticityX: number;
  whitePointChromaticityY: number;
  maxLuminance: number;
  minLuminance: number;
}

/**
 * Content Light Level Information
 */
export interface ContentLightLevelInfo {
  maxCLL: number;
  maxFALL: number;
}

/**
 * HDR Metadata combining mastering display and content light level info
 */
export interface HdrMetadata {
  smpteSt2086?: SmpteSt2086Metadata;
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

  get isHdr(): boolean {
    return this.transfer === 'pq' || this.transfer === 'hlg';
  }

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
 * Common HDR10 display primaries (BT.2020 primaries with D65 white point)
 */
export const HDR10_DISPLAY_PRIMARIES: Pick<
  SmpteSt2086Metadata,
  'primaryRChromaticityX' | 'primaryRChromaticityY' |
  'primaryGChromaticityX' | 'primaryGChromaticityY' |
  'primaryBChromaticityX' | 'primaryBChromaticityY' |
  'whitePointChromaticityX' | 'whitePointChromaticityY'
> = {
  primaryRChromaticityX: 0.708,
  primaryRChromaticityY: 0.292,
  primaryGChromaticityX: 0.170,
  primaryGChromaticityY: 0.797,
  primaryBChromaticityX: 0.131,
  primaryBChromaticityY: 0.046,
  whitePointChromaticityX: 0.3127,
  whitePointChromaticityY: 0.3290,
};
