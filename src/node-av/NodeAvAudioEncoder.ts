/**
 * NodeAvAudioEncoder - Audio encoder using node-av native bindings
 *
 * Implements the AudioEncoderBackend interface for encoding audio samples
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_S32,
  AV_PKT_FLAG_KEY,
  type AVSampleFormat,
  type FFEncoderCodec,
} from 'node-av/constants';

import type {
  AudioEncoderBackend,
  AudioEncoderBackendConfig,
  EncodedFrame,
} from '../backends/types.js';
import { createLogger } from '../utils/logger.js';

// Import from audio-encoder submodule
import {
  OPUS_SAMPLE_RATE,
  getEncoderName,
  getEncoderCodec,
  getChannelLayout,
  convertToPlanar,
  convertToS16Interleaved,
  convertToS32Interleaved,
  convertToS16Planar,
  convertToU8Interleaved,
} from './audio-encoder/index.js';

const logger = createLogger('NodeAvAudioEncoder');

/**
 * NodeAV-backed audio encoder implementing AudioEncoderBackend interface
 */
export class NodeAvAudioEncoder extends EventEmitter implements AudioEncoderBackend {
  private encoder: Encoder | null = null;
  private config: AudioEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean; timestamp?: number }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private sampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private encoderSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLTP;
  private timeBase: Rational = new Rational(1, 1_000_000); // Microsecond timebase
  private codecDescription: Buffer | null = null;
  private firstFrame = true;
  private pendingTimestamp = 0; // Track input timestamp for output correlation
  // Resampling support for Opus with non-48kHz input
  private resampler: FilterAPI | null = null;
  private needsResampling = false;
  private inputSampleRate = 0;
  private encoderSampleRate = 0;

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: AudioEncoderBackendConfig): void {
    this.config = { ...config };

    const codecName = getEncoderName(config.codec);
    const isOpus = codecName === 'libopus';

    // Store sample rates
    this.inputSampleRate = config.sampleRate;
    this.encoderSampleRate = isOpus ? OPUS_SAMPLE_RATE : config.sampleRate;

    // For Opus with non-48kHz input, we need to resample
    this.needsResampling = isOpus && config.sampleRate !== OPUS_SAMPLE_RATE;
    if (this.needsResampling) {
      logger.info(`Opus requires 48kHz, will resample from ${config.sampleRate}Hz`);
    }

    // Set timeBase to match the ENCODER's sample rate (48kHz for Opus)
    // This ensures correct timestamp calculations for encoded output
    this.timeBase = new Rational(1, this.encoderSampleRate);

    // Input is always float32 interleaved from AudioData conversion
    this.sampleFormat = AV_SAMPLE_FMT_FLT;
  }

  write(data: Buffer | Uint8Array, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ buffer: Buffer.from(data), owned: true, timestamp: timestamp ?? this.pendingTimestamp });
    // Advance pending timestamp by the sample count we just added
    const samplesPerChannel = data.byteLength / 4 / (this.config.numberOfChannels ?? 2); // f32 = 4 bytes
    this.pendingTimestamp += (samplesPerChannel * 1_000_000) / this.config.sampleRate;
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame, owned: boolean = true, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    try {
      const buf = frame.toBuffer();
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      // Use provided timestamp, or try to get from frame.pts, or default to 0
      let ts = timestamp;
      if (ts === undefined && (frame as any).pts !== undefined) {
        const pts = (frame as any).pts;
        const tb = (frame as any).timeBase;
        if (tb && typeof tb.num === 'number' && typeof tb.den === 'number') {
          ts = Number((BigInt(pts) * BigInt(tb.num) * 1_000_000n) / BigInt(tb.den));
        }
      }
      this.queue.push({ buffer: Buffer.from(buf), owned: true, timestamp: ts ?? 0 });
      void this.processQueue();
      return true;
    } catch (err) {
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  async shutdown(): Promise<void> {
    this.end();
  }

  private async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      if (this.processing) return;
      this.processing = true;

      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift()!;
          // Emit frameAccepted when frame starts processing (for dequeue event)
          setImmediate(() => this.emit('frameAccepted'));
          if (item.frame) {
            await this.encodeFrame(item.frame, item.owned ?? true, item.timestamp);
          } else if (item.buffer) {
            await this.encodeBuffer(item.buffer, item.timestamp);
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        this.processing = false;
        this.processingPromise = null;
      }
    })();

    return this.processingPromise;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const encoderCodec = getEncoderCodec(this.config.codec);
    const options = this.buildEncoderOptions();

    // Store the encoder's required sample format
    this.encoderSampleFormat = options.sampleFormat;

    logger.info(`Using encoder: ${encoderCodec}, format: ${options.sampleFormat}`);

    this.encoder = await Encoder.create(encoderCodec as FFEncoderCodec, options);

    // Create resampler if needed (e.g., Opus with non-48kHz input)
    if (this.needsResampling && !this.resampler) {
      // Use aresample filter to convert sample rate
      // The filter handles high-quality resampling via libswresample
      const filterDesc = `aresample=${this.encoderSampleRate}:first_pts=0`;
      this.resampler = FilterAPI.create(filterDesc, {} as any);
      logger.info(`Created resampler: ${this.inputSampleRate}Hz -> ${this.encoderSampleRate}Hz`);
    }

    // Extract codec description (extradata) for codecs that require it
    this.extractCodecDescription();
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean, timestamp?: number): Promise<void> {
    try {
      await this.ensureEncoder();
      if (!this.encoder || !this.config) {
        throw new Error('Encoder not initialized');
      }

      // Use provided timestamp or compute from sample position
      const inputTimestamp = timestamp ?? this.pendingTimestamp;

      const matchesFormat = inputFrame.format === this.encoderSampleFormat;
      const matchesRate = Number(inputFrame.sampleRate ?? this.config.sampleRate) === this.config.sampleRate;

      if (matchesFormat && matchesRate) {
        // Set PTS based on actual timestamp
        const sampleRate = Number(inputFrame.sampleRate ?? this.config.sampleRate);
        inputFrame.pts = BigInt(Math.round(inputTimestamp * sampleRate / 1_000_000));
        const nbSamples = inputFrame.nbSamples ?? 0;
        try {
          await this.encoder.encode(inputFrame);
          if (owned) {
            inputFrame.unref();
          }
          await this.drainPackets();
          this.frameIndex += nbSamples;
          return;
        } catch (err) {
          // Fallback to buffer path if direct encode fails
          logger.debug(`Direct frame encode failed, falling back to buffer: ${err instanceof Error ? err.message : err}`);
        }
      }

      const buffer = inputFrame.toBuffer();
      if (owned) {
        inputFrame.unref();
      }
      await this.encodeBuffer(buffer, inputTimestamp);
    } catch (err) {
      if (owned) {
        try { inputFrame.unref(); } catch { /* ignore */ }
      }
      throw err;
    }
  }

  private extractCodecDescription(): void {
    if (!this.encoder || !this.config) return;
    if (this.codecDescription) return; // Already extracted

    const codecBase = this.config.codec.split('.')[0].toLowerCase();

    try {
      const ctx = this.encoder.getCodecContext();
      if (!ctx) return;

      const extraData = ctx.extraData;
      if (!extraData || extraData.length === 0) return;

      if (codecBase === 'mp4a' || codecBase === 'aac') {
        // AAC: extradata contains AudioSpecificConfig (including PCE if needed)
        // This is the proper description for MP4 muxing and decoding
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`AAC description from extradata: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'opus') {
        // Opus: extradata contains OpusHead structure
        // Required for multi-channel Opus decoding
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`Opus description from extradata: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'flac') {
        // FLAC description: 'fLaC' magic + STREAMINFO block
        // The extradata from FFmpeg is just the STREAMINFO, we need to prepend magic
        const magic = Buffer.from('fLaC');
        // STREAMINFO block header: type (0x00 for STREAMINFO) | last-block flag (0x80 if last)
        // followed by 3-byte length
        const blockHeader = Buffer.from([0x80, 0x00, 0x00, extraData.length]);
        this.codecDescription = Buffer.concat([magic, blockHeader, extraData]);
        logger.debug(`FLAC description: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'vorbis') {
        // Vorbis description is the identification + comment + setup headers
        // The extradata from FFmpeg should contain all three headers
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`Vorbis description: ${this.codecDescription.length} bytes`);
      }
    } catch (err) {
      logger.debug(`Failed to extract codec description: ${err}`);
    }
  }

  private buildEncoderOptions() {
    if (!this.config) {
      throw new Error('Config not set');
    }

    const codecBase = this.config.codec.split('.')[0].toLowerCase();
    const isOpus = codecBase === 'opus';
    const isVorbis = codecBase === 'vorbis';
    const isFlac = codecBase === 'flac';
    const isRealtime = this.config.latencyMode === 'realtime';

    // Determine output sample format based on codec requirements
    // Each codec has specific format requirements:
    // - libopus: s16 or flt (interleaved only)
    // - libvorbis: fltp (planar float)
    // - aac: fltp (planar float)
    // - flac: s16, s32 (interleaved signed)
    let sampleFormat: AVSampleFormat;
    if (isOpus) {
      // libopus only supports s16 or flt (interleaved)
      sampleFormat = AV_SAMPLE_FMT_FLT;
    } else if (isVorbis) {
      sampleFormat = AV_SAMPLE_FMT_FLTP;
    } else if (isFlac || codecBase === 'pcm-s16') {
      // flac encoder requires interleaved s16 or s32
      sampleFormat = AV_SAMPLE_FMT_S16;
    } else if (codecBase === 'pcm-s24' || codecBase === 'pcm-s32') {
      sampleFormat = AV_SAMPLE_FMT_S32;
    } else if (codecBase === 'pcm-u8') {
      sampleFormat = AV_SAMPLE_FMT_U8;
    } else if (codecBase === 'ulaw' || codecBase === 'alaw') {
      sampleFormat = AV_SAMPLE_FMT_S16;
    } else {
      // Most codecs work with float planar (aac, etc.)
      sampleFormat = AV_SAMPLE_FMT_FLTP;
    }

    const options: Record<string, string | number> = {};
    const isConstantBitrate = this.config.bitrateMode === 'constant';
    const isVariableBitrate = this.config.bitrateMode === 'variable';

    // Codec-specific options
    if (isOpus) {
      const opusConfig = this.config.opus;
      // Application mode: use config or default based on latency mode
      options.application = opusConfig?.application ?? (isRealtime ? 'voip' : 'audio');
      // Frame duration: use config or default for realtime
      if (opusConfig?.frameDuration !== undefined) {
        // Convert microseconds to milliseconds for libopus
        options.frame_duration = String(opusConfig.frameDuration / 1000);
      } else if (isRealtime) {
        options.frame_duration = '10';
      }
      // Opus VBR control: 'on' (default), 'off' (CBR), 'constrained'
      if (isConstantBitrate) {
        options.vbr = 'off';
      } else if (isVariableBitrate) {
        options.vbr = 'on';
      }
      // Packet loss percentage for FEC
      if (opusConfig?.packetlossperc !== undefined) {
        options.packet_loss = String(opusConfig.packetlossperc);
      }
      // In-band FEC
      if (opusConfig?.useinbandfec !== undefined) {
        options.fec = opusConfig.useinbandfec ? '1' : '0';
      }
      // Discontinuous transmission
      if (opusConfig?.usedtx !== undefined) {
        options.dtx = opusConfig.usedtx ? '1' : '0';
      }
      // Complexity (0-10)
      if (opusConfig?.complexity !== undefined) {
        options.compression_level = String(opusConfig.complexity);
      }
    }

    // AAC bitrateMode: CBR uses bitrate, VBR uses global_quality
    if (codecBase === 'aac' || codecBase === 'mp4a') {
      if (isVariableBitrate && !this.config.bitrate) {
        // VBR mode with quality-based encoding (1-5 scale for libfdk_aac, 0.1-2 for native aac)
        // Use a reasonable default quality
        options.global_quality = 4;
      }
      // CBR is default when bitrate is specified
    }

    // Frame size configuration for specific codecs
    if (isFlac) {
      // FLAC default block size is 4608 samples, which is too large for small inputs
      // Use a smaller frame size to allow encoding of smaller buffers
      options.frame_size = '1024';
    }

    return {
      type: 'audio' as const,
      sampleRate: isOpus ? OPUS_SAMPLE_RATE : this.config.sampleRate,
      channelLayout: getChannelLayout(this.config.numberOfChannels),
      sampleFormat,
      timeBase: this.timeBase,
      bitrate: this.config.bitrate,
      options,
    };
  }

  private async encodeBuffer(buffer: Buffer, timestamp?: number): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }
    // Use provided timestamp or compute from sample position
    const inputTimestamp = timestamp ?? this.pendingTimestamp;

    // Buffer is f32le interleaved, we need to convert to the encoder's expected format
    // Calculate number of samples (each sample is 4 bytes for f32)
    const bytesPerSample = 4;
    const totalSamples = buffer.length / bytesPerSample;
    const samplesPerChannel = Math.floor(totalSamples / this.config.numberOfChannels);

    if (samplesPerChannel === 0) {
      return;
    }

    // Prepare audio data based on encoder's expected format
    let audioData: Buffer;
    let frameFormat: AVSampleFormat;

    if (this.encoderSampleFormat === AV_SAMPLE_FMT_FLT) {
      // Encoder needs interleaved float - use input buffer directly
      audioData = buffer;
      frameFormat = AV_SAMPLE_FMT_FLT;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16) {
      // Encoder needs interleaved s16 - convert from f32 interleaved to s16 interleaved
      audioData = Buffer.from(convertToS16Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16P) {
      // Encoder needs planar s16 - convert from f32 interleaved to s16 planar
      audioData = Buffer.from(convertToS16Planar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16P;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S32) {
      // Encoder needs interleaved s32 - convert from f32 interleaved to s32 interleaved
      audioData = Buffer.from(convertToS32Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S32;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_U8) {
      audioData = Buffer.from(convertToU8Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_U8;
    } else {
      // Default: encoder needs planar float - convert from f32 interleaved to f32 planar
      audioData = Buffer.from(convertToPlanar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_FLTP;
    }

    // Create input frame at INPUT sample rate
    const inputFrame = Frame.fromAudioBuffer(audioData, {
      sampleRate: this.inputSampleRate,
      channelLayout: getChannelLayout(this.config.numberOfChannels),
      format: frameFormat,
      nbSamples: samplesPerChannel,
      timeBase: new Rational(1, this.inputSampleRate),
    });

    // If resampling is needed, process through resampler
    if (this.needsResampling && this.resampler) {
      // Set input PTS based on actual input timestamp (converted to sample units)
      // PTS = timestamp_us * sampleRate / 1_000_000
      const ptsInSamples = BigInt(Math.round(inputTimestamp * this.inputSampleRate / 1_000_000));
      inputFrame.pts = ptsInSamples;

      await this.resampler.process(inputFrame);
      inputFrame.unref();

      // Drain all resampled frames and encode them
      // Note: receive() returns null when no output is ready yet, undefined/false when done
      let resampledFrame = await this.resampler.receive();
      while (resampledFrame) {
        const outputSamples = resampledFrame.nbSamples ?? 0;
        // Use input timestamp converted to encoder sample rate for PTS
        // Do NOT add frameIndex - that would cause timestamp drift
        // PTS = timestamp_us * encoderSampleRate / 1_000_000
        const outputPts = BigInt(Math.round(inputTimestamp * this.encoderSampleRate / 1_000_000));
        resampledFrame.pts = outputPts;

        await this.encoder.encode(resampledFrame);
        resampledFrame.unref();

        this.frameIndex += outputSamples;

        // Get next frame
        resampledFrame = await this.resampler.receive();
      }
    } else {
      // No resampling - encode directly
      // PTS = timestamp_us * sampleRate / 1_000_000
      const ptsInSamples = BigInt(Math.round(inputTimestamp * this.inputSampleRate / 1_000_000));
      inputFrame.pts = ptsInSamples;
      await this.encoder.encode(inputFrame);
      inputFrame.unref();
      this.frameIndex += samplesPerChannel;
    }

    // Try to extract codec description after first encode (some codecs like FLAC
    // don't populate extradata until after encoding starts)
    this.extractCodecDescription();

    await this.drainPackets();
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    // Flush resampler if present - encode any remaining buffered samples
    if (this.resampler && this.encoder) {
      try {
        // Signal EOF to resampler to flush its internal buffers
        await this.resampler.process(null as any);

        // Drain remaining frames
        let resampledFrame = await this.resampler.receive();
        while (resampledFrame) {
          const outputSamples = resampledFrame.nbSamples ?? 0;
          resampledFrame.pts = BigInt(this.frameIndex);
          await this.encoder.encode(resampledFrame);
          resampledFrame.unref();
          this.frameIndex += outputSamples;

          resampledFrame = await this.resampler.receive();
        }
        await this.drainPackets();
      } catch (err) {
        // Resampler flush errors are non-fatal
        logger.debug(`Resampler flush error: ${err}`);
      }
    }

    if (this.encoder) {
      try {
        await this.encoder.flush();
        await this.drainPackets();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('close', 0);
    this.cleanup();
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || (packet as any).isKeyframe;

        // Get actual duration from packet (in timebase units), convert to samples
        // This handles variable frame sizes (PCM, Opus with different frame durations)
        let durationSamples: number | undefined;
        if (packet.duration !== undefined && packet.duration > 0n) {
          const tb = packet.timeBase;
          if (tb && tb.den > 0) {
            // duration is in timebase units, convert to samples at encoder sample rate
            // duration_seconds = duration * (tb.num / tb.den)
            // duration_samples = duration_seconds * sampleRate
            durationSamples = Number((packet.duration * BigInt(tb.num) * BigInt(this.encoderSampleRate)) / BigInt(tb.den));
          }
        }

        const frameData: any = {
          data: Buffer.from(packet.data),
          timestamp,
          keyFrame,
          durationSamples,
        };
        // Include codec description on the first frame
        if (this.firstFrame && this.codecDescription) {
          frameData.description = this.codecDescription;
          this.firstFrame = false;
        }
        this.emit('encodedFrame', frameData);
      }
      packet.unref();
      packet = await this.encoder.receive();
    }
  }

  private cleanup(): void {
    this.resampler?.close();
    this.resampler = null;
    this.encoder?.close();
    this.encoder = null;
    this.queue = [];
  }
}
