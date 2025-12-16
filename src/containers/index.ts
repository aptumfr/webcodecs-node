/**
 * Container handling module for WebCodecs
 *
 * This module provides container (MP4, WebM, MKV) demuxing, muxing, and transcoding
 * capabilities using node-av as the backend.
 *
 * @example
 * ```typescript
 * import { Demuxer, transcode, getMediaInfo } from 'webcodecs-node/containers';
 *
 * // Get media info
 * const info = await getMediaInfo('video.mp4');
 * console.log(info.video.codec, info.video.width, info.video.height);
 *
 * // Demux video chunks for WebCodecs processing
 * const demuxer = new Demuxer({ path: 'video.mp4' });
 * await demuxer.open();
 * for await (const chunk of demuxer.videoChunks()) {
 *   // Feed to VideoDecoder...
 * }
 * await demuxer.close();
 *
 * // Transcode to different codec/settings
 * await transcode('input.mp4', 'output.mp4', {
 *   videoCodec: 'h264',
 *   videoBitrate: 1_000_000,
 * });
 *
 * // Remux to different container (no re-encoding)
 * await remux('input.mp4', 'output.mkv');
 * ```
 */

// Demuxer
export { Demuxer } from './Demuxer.js';
export type {
  DemuxerConfig,
  VideoStreamConfig,
  AudioStreamConfig,
  VideoChunkCallback,
  AudioChunkCallback,
} from './Demuxer.js';

// Muxer
export { Muxer, StreamCopier } from './Muxer.js';
export type { MuxerConfig, VideoTrackConfig, AudioTrackConfig } from './Muxer.js';

// Transcoding utilities
export { remux, transcode, getMediaInfo } from './transcode.js';
export type {
  TranscodeOptions,
  TranscodeProgress,
  TranscodeResult,
  MediaInfo,
  VideoCodec,
  AudioCodec,
  HardwareAcceleration,
} from './transcode.js';

// Frame extraction
export { extractVideoFrames } from './extract.js';
