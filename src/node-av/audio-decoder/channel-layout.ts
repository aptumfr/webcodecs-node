/**
 * Channel layout utilities for audio decoding
 */

import {
  AV_CHANNEL_ORDER_NATIVE,
  AV_CH_LAYOUT_MONO,
  AV_CH_LAYOUT_STEREO,
  AV_CH_LAYOUT_5POINT1,
  AV_CH_LAYOUT_7POINT1,
} from 'node-av/constants';

/**
 * Get FFmpeg channel layout for a given number of channels
 */
export function getChannelLayout(numChannels: number): { nbChannels: number; order: number; mask: bigint } {
  // Standard channel layouts as ChannelLayout objects
  // Order 1 = AV_CHANNEL_ORDER_NATIVE (required for FFmpeg)
  switch (numChannels) {
    case 1:
      return { nbChannels: 1, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_MONO };
    case 2:
      return { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO };
    case 6:
      return { nbChannels: 6, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_5POINT1 };
    case 8:
      return { nbChannels: 8, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_7POINT1 };
    default:
      return { nbChannels: numChannels, order: AV_CHANNEL_ORDER_NATIVE, mask: BigInt((1 << numChannels) - 1) };
  }
}
