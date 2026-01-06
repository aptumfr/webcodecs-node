/**
 * FFmpeg color space enum value mappings
 */

/**
 * FFmpeg AVColorPrimaries enum values
 */
export const AVCOL_PRI_VALUES = {
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
 */
export const AVCOL_TRC_VALUES = {
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
  IEC61966_2_1: 13,
  BT2020_10: 14,
  BT2020_12: 15,
  SMPTE2084: 16,
  SMPTE428: 17,
  ARIB_STD_B67: 18,
} as const;

/**
 * FFmpeg AVColorSpace enum values (matrix coefficients)
 */
export const AVCOL_SPC_VALUES = {
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
 */
export const AVCOL_RANGE_VALUES = {
  UNSPECIFIED: 0,
  MPEG: 1,
  JPEG: 2,
} as const;
