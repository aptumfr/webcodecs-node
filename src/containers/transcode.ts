/**
 * High-level transcoding utilities using node-av
 *
 * Provides easy-to-use functions for common transcoding operations.
 * Uses node-av internally for efficient end-to-end processing.
 */

import {
  Demuxer as NodeAvDemuxer,
  Muxer as NodeAvMuxer,
  Decoder as NodeAvDecoder,
  Encoder as NodeAvEncoder,
  HardwareContext,
  FilterAPI,
  AV_CODEC_ID_H264,
  AV_CODEC_ID_HEVC,
  AV_CODEC_ID_VP8,
  AV_CODEC_ID_VP9,
  AV_CODEC_ID_AV1,
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_NV12,
} from 'node-av';
import { Demuxer } from './Demuxer.js';
import { StreamCopier } from './Muxer.js';

/**
 * Video codec options for transcoding
 */
export type VideoCodec = 'h264' | 'hevc' | 'vp8' | 'vp9' | 'av1' | 'copy';

/**
 * Audio codec options for transcoding
 */
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'copy';

/**
 * Hardware acceleration preference
 */
export type HardwareAcceleration = 'no-preference' | 'prefer-hardware' | 'prefer-software';

/**
 * Transcoding options
 */
export interface TranscodeOptions {
  /** Target video codec */
  videoCodec?: VideoCodec;
  /** Target audio codec */
  audioCodec?: AudioCodec;
  /** Target video bitrate in bits per second */
  videoBitrate?: number;
  /** Target audio bitrate in bits per second */
  audioBitrate?: number;
  /** Target video width (maintains aspect ratio if only width specified) */
  width?: number;
  /** Target video height */
  height?: number;
  /** Target framerate */
  framerate?: number;
  /** GOP size (keyframe interval) */
  gopSize?: number;
  /** Target audio sample rate */
  sampleRate?: number;
  /** Target number of audio channels */
  numberOfChannels?: number;
  /** Output container format (mp4, webm, mkv) - inferred from extension if not specified */
  format?: string;
  /** Hardware acceleration preference (default: 'no-preference') */
  hardwareAcceleration?: HardwareAcceleration;
  /** Progress callback */
  onProgress?: (progress: TranscodeProgress) => void;
}

/**
 * Progress information during transcoding
 */
export interface TranscodeProgress {
  /** Number of video frames processed */
  videoFrames: number;
  /** Number of audio frames processed */
  audioFrames: number;
  /** Estimated progress (0-1) if duration is known */
  progress?: number;
}

/**
 * Transcoding result
 */
export interface TranscodeResult {
  /** Number of video frames transcoded */
  videoFrames: number;
  /** Number of audio frames transcoded */
  audioFrames: number;
  /** Output file size in bytes */
  outputSize: number;
}

/**
 * Map video codec string to FFmpeg codec ID
 */
function getVideoCodecId(codec: VideoCodec): number {
  switch (codec) {
    case 'h264':
      return AV_CODEC_ID_H264;
    case 'hevc':
      return AV_CODEC_ID_HEVC;
    case 'vp8':
      return AV_CODEC_ID_VP8;
    case 'vp9':
      return AV_CODEC_ID_VP9;
    case 'av1':
      return AV_CODEC_ID_AV1;
    default:
      return AV_CODEC_ID_H264;
  }
}

/**
 * Map audio codec string to FFmpeg codec ID
 */
function getAudioCodecId(codec: AudioCodec): number {
  switch (codec) {
    case 'aac':
      return AV_CODEC_ID_AAC;
    case 'opus':
      return AV_CODEC_ID_OPUS;
    case 'mp3':
      return AV_CODEC_ID_MP3;
    default:
      return AV_CODEC_ID_AAC;
  }
}

/**
 * Build filter chain for transcoding based on hardware configuration
 * Handles: hardware frame download, format conversion, and optionally hardware upload
 */
function buildTranscodeFilterChain(
  hwType: string,
  hwDecoder: boolean,
  hwEncoder: boolean,
  targetFormat: string
): string | null {
  // Case 1: Both hardware - try to stay on GPU
  if (hwDecoder && hwEncoder) {
    switch (hwType) {
      case 'vaapi':
        return `scale_vaapi=format=${targetFormat}`;
      case 'cuda':
        return `scale_cuda=format=${targetFormat}`;
      case 'qsv':
        return `vpp_qsv=format=${targetFormat}`;
      case 'videotoolbox':
        return `scale_vt=format=${targetFormat}`;
    }
  }

  // Case 2: Hardware decoder only - download and convert
  if (hwDecoder && !hwEncoder) {
    return `hwdownload,format=nv12,format=${targetFormat}`;
  }

  // Case 3: Hardware encoder only - convert and upload
  if (!hwDecoder && hwEncoder) {
    switch (hwType) {
      case 'vaapi':
        return `format=nv12,hwupload`;
      case 'cuda':
        return `format=nv12,hwupload_cuda`;
      case 'qsv':
        return `format=nv12,hwupload=extra_hw_frames=64`;
      case 'videotoolbox':
        return `format=nv12,hwupload`;
    }
  }

  // Case 4: Both software - no filter needed
  return null;
}

/**
 * Infer container format from file extension
 */
function inferFormat(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'mp4';
    case 'webm':
      return 'webm';
    case 'mkv':
      return 'matroska';
    case 'mov':
      return 'mov';
    case 'avi':
      return 'avi';
    case 'ts':
      return 'mpegts';
    default:
      return 'mp4';
  }
}

/**
 * Remux a file from one container format to another without re-encoding
 *
 * This is a fast operation that just changes the container format.
 * The video and audio streams are copied without modification.
 *
 * @example
 * ```typescript
 * // Convert MP4 to MKV container (keeping same codecs)
 * await remux('input.mp4', 'output.mkv');
 * ```
 */
export async function remux(inputPath: string, outputPath: string): Promise<void> {
  await StreamCopier.remux(inputPath, outputPath);
}

/**
 * Transcode a video file to different codecs/settings
 *
 * Uses node-av internally for efficient end-to-end processing.
 *
 * @example
 * ```typescript
 * // Convert to H.264 with lower bitrate
 * await transcode('input.mp4', 'output.mp4', {
 *   videoCodec: 'h264',
 *   videoBitrate: 1_000_000,
 * });
 *
 * // Convert to VP9 WebM
 * await transcode('input.mp4', 'output.webm', {
 *   videoCodec: 'vp9',
 *   videoBitrate: 2_000_000,
 * });
 * ```
 */
export async function transcode(
  inputPath: string,
  outputPath: string,
  options: TranscodeOptions = {}
): Promise<TranscodeResult> {
  // Check for stream copy mode
  if (options.videoCodec === 'copy' && options.audioCodec === 'copy') {
    await remux(inputPath, outputPath);
    const { stat } = await import('fs/promises');
    const info = await stat(outputPath);
    return { videoFrames: 0, audioFrames: 0, outputSize: info.size };
  }

  // Open input
  const demuxer = await NodeAvDemuxer.open(inputPath);
  const inputVideo = demuxer.video();
  const inputAudio = demuxer.audio();

  if (!inputVideo && !inputAudio) {
    await demuxer.close();
    throw new Error('No video or audio streams in input file');
  }

  // Setup hardware acceleration if requested
  const useHardware = options.hardwareAcceleration === 'prefer-hardware';
  let hardware: HardwareContext | null = null;
  let videoFilter: FilterAPI | null = null;
  let usingHardwareDecoder = false;
  let usingHardwareEncoder = false;

  if (useHardware) {
    // Try hardware backends in order of reliability
    // VAAPI tends to be more stable on Linux than QSV
    const hwTypesToTry = ['vaapi', 'cuda', 'qsv', 'videotoolbox'];
    for (const hwType of hwTypesToTry) {
      try {
        hardware = HardwareContext.create(hwType as any);
        console.log(`Using hardware acceleration: ${hardware?.deviceTypeName}`);
        break;
      } catch {
        // Try next backend
      }
    }
    if (!hardware) {
      try {
        // Fallback to auto-detection
        hardware = HardwareContext.auto();
        console.log(`Using hardware acceleration (auto): ${hardware?.deviceTypeName}`);
      } catch {
        console.log('Hardware acceleration not available, using software');
        hardware = null;
      }
    }
  }

  // Create output muxer
  const format = options.format || inferFormat(outputPath);
  const muxer = await NodeAvMuxer.open(outputPath, { format });

  // Setup video pipeline
  let videoDecoder: any = null;
  let videoEncoder: any = null;
  let videoOutStreamIndex = -1;
  let videoFrameCount = 0;
  let videoPacketCount = 0;

  if (inputVideo && options.videoCodec !== 'copy') {
    const cp = inputVideo.codecpar;
    const outputWidth = options.width || cp.width;
    const outputHeight = options.height || cp.height;
    const outputCodecId = getVideoCodecId(options.videoCodec || 'h264');
    const codecName = options.videoCodec || 'h264';

    // Create decoder with hardware acceleration if available
    try {
      videoDecoder = await NodeAvDecoder.create(inputVideo, {
        hardware: hardware ?? undefined,
        extraHwFrames: 64, // Allocate extra frames for hardware decoding pipeline
      } as any);
      usingHardwareDecoder = hardware !== null && videoDecoder.isHardware?.();
      if (usingHardwareDecoder) {
        console.log(`Using hardware decoder for ${codecName}`);
      }
    } catch (decErr) {
      // Fallback to software decoder
      console.log(`Hardware decoder failed: ${(decErr as Error).message}, using software`);
      videoDecoder = await NodeAvDecoder.create(inputVideo);
    }

    // Create encoder with hardware acceleration if available
    let encoderCodec: any = outputCodecId;
    let encoderPixelFormat = AV_PIX_FMT_YUV420P;

    if (hardware) {
      try {
        const hwCodec = hardware.getEncoderCodec(codecName as any);
        if (hwCodec) {
          encoderCodec = hwCodec;
          encoderPixelFormat = AV_PIX_FMT_NV12; // Hardware encoders typically use NV12
          usingHardwareEncoder = true;
          console.log(`Using hardware encoder for ${codecName}`);
        }
      } catch {
        // Fallback to software encoder
      }
    }

    // Create encoder
    try {
      videoEncoder = await NodeAvEncoder.create(encoderCodec, {
        width: outputWidth,
        height: outputHeight,
        pixelFormat: encoderPixelFormat,
        timeBase: { num: 1, den: options.framerate || 30 },
        frameRate: { num: options.framerate || 30, den: 1 },
        bitrate: options.videoBitrate || 1_000_000,
        gopSize: options.gopSize || 30,
        hardware: usingHardwareEncoder ? hardware ?? undefined : undefined,
        extraHwFrames: 64,
      } as any);
    } catch (encErr) {
      // Fallback to software encoder if hardware fails
      if (usingHardwareEncoder) {
        console.log(`Hardware encoder failed: ${(encErr as Error).message}, using software`);
        usingHardwareEncoder = false;
        encoderPixelFormat = AV_PIX_FMT_YUV420P;
        videoEncoder = await NodeAvEncoder.create(outputCodecId as any, {
          width: outputWidth,
          height: outputHeight,
          pixelFormat: encoderPixelFormat,
          timeBase: { num: 1, den: options.framerate || 30 },
          frameRate: { num: options.framerate || 30, den: 1 },
          bitrate: options.videoBitrate || 1_000_000,
          gopSize: options.gopSize || 30,
        } as any);
      } else {
        throw encErr;
      }
    }

    // Create video filter for format conversion between decoder and encoder
    // This handles: hardware frame download, format conversion, and optionally hardware upload
    // Created AFTER encoder is finalized to know the actual configuration
    if (usingHardwareDecoder || usingHardwareEncoder) {
      const filterChain = buildTranscodeFilterChain(
        hardware?.deviceTypeName || 'software',
        usingHardwareDecoder,
        usingHardwareEncoder,
        encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p'
      );

      if (filterChain) {
        try {
          videoFilter = FilterAPI.create(filterChain, {
            hardware: hardware ?? undefined,
          } as any);
          console.log(`Using filter chain: ${filterChain}`);
        } catch (err) {
          console.log(`Filter chain failed, using simple format conversion: ${(err as Error).message}`);
          // Fallback to simple format conversion
          videoFilter = FilterAPI.create(`format=${encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p'}`);
        }
      }
    }

    videoOutStreamIndex = muxer.addStream(videoEncoder);
  } else if (inputVideo && options.videoCodec === 'copy') {
    // Stream copy video
    videoOutStreamIndex = muxer.addStream(inputVideo);
  }

  // Setup audio pipeline
  let audioDecoder: any = null;
  let audioEncoder: any = null;
  let audioOutStreamIndex = -1;
  let audioFrameCount = 0;

  if (inputAudio && options.audioCodec !== 'copy') {
    const cp = inputAudio.codecpar;
    const outputCodecId = getAudioCodecId(options.audioCodec || 'aac');

    // Create decoder
    audioDecoder = await NodeAvDecoder.create(inputAudio);

    // Create encoder
    audioEncoder = await NodeAvEncoder.create(outputCodecId as any, {
      sampleRate: options.sampleRate || cp.sampleRate,
      channels: options.numberOfChannels || cp.channels,
      bitrate: options.audioBitrate || 128_000,
    } as any);

    audioOutStreamIndex = muxer.addStream(audioEncoder);
  } else if (inputAudio && options.audioCodec === 'copy') {
    // Stream copy audio
    audioOutStreamIndex = muxer.addStream(inputAudio);
  }

  // Helper to drain encoder packets
  async function drainVideoEncoder() {
    if (!videoEncoder) return;
    while (true) {
      try {
        const pkt = await videoEncoder.receive();
        if (pkt) {
          await muxer.writePacket(pkt, videoOutStreamIndex);
          videoPacketCount++;
        } else break;
      } catch {
        break;
      }
    }
  }

  async function drainAudioEncoder() {
    if (!audioEncoder) return;
    while (true) {
      try {
        const pkt = await audioEncoder.receive();
        if (pkt) {
          await muxer.writePacket(pkt, audioOutStreamIndex);
        } else break;
      } catch {
        break;
      }
    }
  }

  // Helper to drain decoder frames and encode
  async function drainVideoDecoder() {
    if (!videoDecoder || !videoEncoder) return;
    while (true) {
      try {
        let frame = await videoDecoder.receive();
        if (!frame) break;

        // Apply video filter if present (handles hw download/upload and format conversion)
        if (videoFilter) {
          try {
            await videoFilter.process(frame);
            frame.free();
            frame = await videoFilter.receive();
            if (!frame) continue;
          } catch (filterErr) {
            // Filter failed, try to continue without it
            console.warn(`Filter processing failed: ${(filterErr as Error).message}`);
            frame.free();
            continue;
          }
        }

        frame.pts = BigInt(videoFrameCount);
        videoFrameCount++;
        await videoEncoder.encode(frame);
        frame.free();
        await drainVideoEncoder();

        // Report progress
        if (options.onProgress) {
          const duration = demuxer.duration || 0;
          options.onProgress({
            videoFrames: videoFrameCount,
            audioFrames: audioFrameCount,
            progress: duration > 0 ? videoFrameCount / (duration * 30) : undefined,
          });
        }
      } catch {
        break;
      }
    }
  }

  async function drainAudioDecoder() {
    if (!audioDecoder || !audioEncoder) return;
    while (true) {
      try {
        const frame = await audioDecoder.receive();
        if (!frame) break;
        audioFrameCount++;
        await audioEncoder.encode(frame);
        frame.free();
        await drainAudioEncoder();
      } catch {
        break;
      }
    }
  }

  // Process all packets
  let hardwareDecodeFailed = false;
  for await (const packet of demuxer.packets()) {
    if (!packet) continue;

    if (packet.streamIndex === inputVideo?.index) {
      if (videoDecoder && videoEncoder && !hardwareDecodeFailed) {
        // Transcode video
        try {
          await videoDecoder.decode(packet);
          await drainVideoDecoder();
        } catch (decodeErr) {
          // Hardware decoding can fail mid-stream, rethrow with context
          const errMsg = (decodeErr as Error).message;
          if (errMsg.includes('allocate') || errMsg.includes('memory') || errMsg.includes('hardware')) {
            throw new Error(`Hardware decoding failed: ${errMsg}. Try with hardwareAcceleration: 'prefer-software'`);
          }
          throw decodeErr;
        }
      } else if (videoOutStreamIndex >= 0) {
        // Stream copy video
        await muxer.writePacket(packet, videoOutStreamIndex);
        videoPacketCount++;
      }
    } else if (packet.streamIndex === inputAudio?.index) {
      if (audioDecoder && audioEncoder) {
        // Transcode audio
        await audioDecoder.decode(packet);
        await drainAudioDecoder();
      } else if (audioOutStreamIndex >= 0) {
        // Stream copy audio
        await muxer.writePacket(packet, audioOutStreamIndex);
      }
    }
  }

  // Flush decoders and encoders
  if (videoDecoder) {
    await videoDecoder.flush();
    await drainVideoDecoder();
  }
  if (videoEncoder) {
    await videoEncoder.flush();
    await drainVideoEncoder();
  }
  if (audioDecoder) {
    await audioDecoder.flush();
    await drainAudioDecoder();
  }
  if (audioEncoder) {
    await audioEncoder.flush();
    await drainAudioEncoder();
  }

  // Close everything
  if (videoFilter) videoFilter.close();
  if (videoDecoder) await videoDecoder.close();
  if (videoEncoder) await videoEncoder.close();
  if (audioDecoder) await audioDecoder.close();
  if (audioEncoder) await audioEncoder.close();
  if (hardware) hardware.dispose();
  await demuxer.close();
  await muxer.close();

  // Get output file size
  const { stat } = await import('fs/promises');
  const info = await stat(outputPath);

  return {
    videoFrames: videoFrameCount,
    audioFrames: audioFrameCount,
    outputSize: info.size,
  };
}

/**
 * Get media information from a container file
 */
export interface MediaInfo {
  format: string;
  duration: number;
  video?: {
    codec: string;
    width: number;
    height: number;
  };
  audio?: {
    codec: string;
    sampleRate: number;
    channels: number;
  };
}

export async function getMediaInfo(inputPath: string): Promise<MediaInfo> {
  const demuxer = new Demuxer({ path: inputPath });
  await demuxer.open();

  const info: MediaInfo = {
    format: demuxer.format || 'unknown',
    duration: demuxer.duration || 0,
  };

  const videoConfig = demuxer.videoConfig;
  if (videoConfig) {
    info.video = {
      codec: videoConfig.codec,
      width: videoConfig.codedWidth,
      height: videoConfig.codedHeight,
    };
  }

  const audioConfig = demuxer.audioConfig;
  if (audioConfig) {
    info.audio = {
      codec: audioConfig.codec,
      sampleRate: audioConfig.sampleRate,
      channels: audioConfig.numberOfChannels,
    };
  }

  await demuxer.close();
  return info;
}

/**
 * Extract video frames from a container file as VideoFrame objects
 *
 * @example
 * ```typescript
 * import { extractVideoFrames } from 'webcodecs-node/containers';
 *
 * for await (const frame of extractVideoFrames('input.mp4')) {
 *   console.log(`Frame: ${frame.timestamp}us`);
 *   frame.close();
 * }
 * ```
 */
export { extractVideoFrames } from './extract.js';
