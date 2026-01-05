/**
 * Tests for AudioEncoder class
 */
import { jest } from '@jest/globals';
import { AudioEncoder } from '../encoders/AudioEncoder.js';
import { AudioData } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { Frame, Rational } from 'node-av';
import { AV_SAMPLE_FMT_FLT } from 'node-av/constants';

describe('AudioEncoder', () => {
  describe('isConfigSupported', () => {
    it('should support Opus', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support AAC', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support MP3', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp3',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should create encoder with callbacks', () => {
      const output = jest.fn();
      const error = jest.fn();

      const encoder = new AudioEncoder({ output, error });

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });

    it('should throw without output callback', () => {
      expect(() => new AudioEncoder({ output: null as any, error: () => {} })).toThrow();
    });
  });

  describe('configure', () => {
    it('should configure encoder', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should throw on closed encoder', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow();
    });
  });

  describe('encode and flush', () => {
    it('should encode audio samples', async () => {
      const chunks: EncodedAudioChunk[] = [];

      const encoder = new AudioEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        bitrate: 128000,
      });

      // Create test audio (1 second of samples)
      const sampleRate = 44100;
      const channels = 2;
      const samplesPerChunk = 1024;
      const numChunks = 10;

      for (let i = 0; i < numChunks; i++) {
        const data = new Float32Array(samplesPerChunk * channels);
        // Generate sine wave
        for (let j = 0; j < samplesPerChunk; j++) {
          const t = (i * samplesPerChunk + j) / sampleRate;
          const sample = Math.sin(2 * Math.PI * 440 * t) * 0.5;
          for (let ch = 0; ch < channels; ch++) {
            data[j * channels + ch] = sample;
          }
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate,
          numberOfChannels: channels,
          numberOfFrames: samplesPerChunk,
          timestamp: (i * samplesPerChunk * 1_000_000) / sampleRate,
          data,
        });

        encoder.encode(audioData);
        audioData.close();
      }

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    it('should encode native node-av frames without extra copy', async () => {
      const chunks: EncodedAudioChunk[] = [];
      let err: Error | null = null;

      const encoder = new AudioEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (e) => { err = e; },
      });

      const sampleRate = 48000;
      const channels = 2;
      const samples = 960;

      encoder.configure({
        codec: 'opus',
        sampleRate,
        numberOfChannels: channels,
        bitrate: 128000,
      });

      const buffer = Buffer.alloc(samples * channels * 4);
      const view = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const sample = Math.sin(2 * Math.PI * 220 * t) * 0.25;
        for (let ch = 0; ch < channels; ch++) {
          view[i * channels + ch] = sample;
        }
      }

      const frame = Frame.fromAudioBuffer(buffer, {
        sampleRate,
        channelLayout: { nbChannels: channels, order: 1, mask: BigInt((1 << channels) - 1) },
        format: AV_SAMPLE_FMT_FLT,
        nbSamples: samples,
        timeBase: new Rational(1, sampleRate),
      });

      const audioData = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfChannels: channels,
        numberOfFrames: samples,
        timestamp: 0,
        data: new Uint8Array(0),
        _nativeFrame: frame,
        _nativeCleanup: () => frame.unref(),
      } as any);

      encoder.encode(audioData);
      audioData.close();

      await encoder.flush();
      encoder.close();

      if (err) {
        throw err;
      }

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    it('should encode Opus from 44.1kHz input (resampling path)', async () => {
      const chunks: EncodedAudioChunk[] = [];
      let decoderConfig: { sampleRate?: number } | undefined;
      let err: Error | null = null;

      const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
          chunks.push(chunk);
          if (metadata?.decoderConfig) {
            decoderConfig = metadata.decoderConfig;
          }
        },
        error: (e) => { err = e; },
      });

      // Configure Opus with 44.1kHz input - this triggers the resampling path
      const inputSampleRate = 44100;
      const channels = 2;
      const samplesPerChunk = 1024;
      const numChunks = 10;

      encoder.configure({
        codec: 'opus',
        sampleRate: inputSampleRate,
        numberOfChannels: channels,
        bitrate: 128000,
      });

      // Encode audio at 44.1kHz
      for (let i = 0; i < numChunks; i++) {
        const data = new Float32Array(samplesPerChunk * channels);
        // Generate sine wave
        for (let j = 0; j < samplesPerChunk; j++) {
          const t = (i * samplesPerChunk + j) / inputSampleRate;
          const sample = Math.sin(2 * Math.PI * 440 * t) * 0.5;
          for (let ch = 0; ch < channels; ch++) {
            data[j * channels + ch] = sample;
          }
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate: inputSampleRate,
          numberOfChannels: channels,
          numberOfFrames: samplesPerChunk,
          timestamp: (i * samplesPerChunk * 1_000_000) / inputSampleRate,
          data,
        });

        encoder.encode(audioData);
        audioData.close();
      }

      await encoder.flush();
      encoder.close();

      if (err) {
        throw err;
      }

      // Verify encoding succeeded
      expect(chunks.length).toBeGreaterThan(0);

      // Verify decoderConfig reports 48kHz (the actual Opus encoder rate)
      expect(decoderConfig).toBeDefined();
      expect(decoderConfig?.sampleRate).toBe(48000);

      // Verify timestamps are reasonable (should be based on 48kHz output)
      // First chunk should have timestamp >= 0
      expect(chunks[0].timestamp).toBeGreaterThanOrEqual(0);

      // Last chunk timestamp should reflect ~10 chunks worth of audio
      // At 44.1kHz input, 10 * 1024 samples = ~232ms
      // Output timestamps are in microseconds
      const expectedDurationUs = (numChunks * samplesPerChunk * 1_000_000) / inputSampleRate;
      const lastChunk = chunks[chunks.length - 1];
      // Allow some tolerance for encoder delay/buffering
      expect(lastChunk.timestamp).toBeLessThan(expectedDurationUs + 100_000);
    }, 30000);
  });

  describe('reset', () => {
    it('should reset encoder to unconfigured state', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(encoder.state).toBe('configured');

      encoder.reset();

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });
  });

  describe('configure validation', () => {
    it('should throw TypeError for missing config', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() => encoder.configure(null as any)).toThrow(TypeError);
      expect(() => encoder.configure(undefined as any)).toThrow(TypeError);
      encoder.close();
    });

    it('should throw TypeError for invalid codec', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: '',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 123 as any,
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid sampleRate', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 0,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: -44100,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid numberOfChannels', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 0,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: -1,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw NotSupportedError for unsupported codec', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'unsupported-codec',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow("Codec 'unsupported-codec' is not supported");

      encoder.close();
    });
  });

  describe('reconfigure', () => {
    it('should allow calling configure multiple times', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      // First configuration
      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      expect(encoder.state).toBe('configured');

      // Reconfigure with different settings
      encoder.configure({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
      });
      expect(encoder.state).toBe('configured');

      encoder.close();
    });

    it('should throw when reconfiguring after close', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() => {
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        });
      }).toThrow('Encoder is closed');
    });
  });

  describe('Opus codec-specific config validation', () => {
    it('should accept valid Opus config with packetlossperc', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: {
          packetlossperc: 10,
        },
      });

      expect(support.supported).toBe(true);
      expect(support.config.opus?.packetlossperc).toBe(10);
    });

    it('should reject Opus config with packetlossperc < 0', async () => {
      // Invalid packetlossperc should throw TypeError per WebCodecs spec
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: {
          packetlossperc: -1,
        },
      })).rejects.toThrow(TypeError);
    });

    it('should reject Opus config with packetlossperc > 100', async () => {
      // Invalid packetlossperc should throw TypeError per WebCodecs spec
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: {
          packetlossperc: 101,
        },
      })).rejects.toThrow(TypeError);
    });

    it('should accept packetlossperc at boundary values (0 and 100)', async () => {
      const support0 = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { packetlossperc: 0 },
      });
      expect(support0.supported).toBe(true);

      const support100 = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { packetlossperc: 100 },
      });
      expect(support100.supported).toBe(true);
    });

    it('should accept valid Opus frameDuration values', async () => {
      const validDurations = [2500, 5000, 10000, 20000, 40000, 60000];
      for (const frameDuration of validDurations) {
        const support = await AudioEncoder.isConfigSupported({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
          opus: { frameDuration },
        });
        expect(support.supported).toBe(true);
        expect(support.config.opus?.frameDuration).toBe(frameDuration);
      }
    });

    it('should reject invalid Opus frameDuration', async () => {
      // Invalid frameDuration should throw TypeError per WebCodecs spec
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { frameDuration: 15000 }, // Invalid value
      })).rejects.toThrow(TypeError);
    });

    it('should accept valid Opus complexity values (0-10)', async () => {
      for (let complexity = 0; complexity <= 10; complexity++) {
        const support = await AudioEncoder.isConfigSupported({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
          opus: { complexity },
        });
        expect(support.supported).toBe(true);
      }
    });

    it('should reject invalid Opus complexity', async () => {
      // Invalid complexity values should throw TypeError per WebCodecs spec
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { complexity: -1 },
      })).rejects.toThrow(TypeError);

      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { complexity: 11 },
      })).rejects.toThrow(TypeError);
    });

    it('should accept full Opus config with all options', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: {
          format: 'opus',
          frameDuration: 20000,
          application: 'audio',
          packetlossperc: 5,
          useinbandfec: true,
          usedtx: false,
          signal: 'music',
          complexity: 8,
        },
      });

      expect(support.supported).toBe(true);
      // Should include all values including defaults filled in
      expect(support.config.opus).toEqual({
        format: 'opus',
        frameDuration: 20000,
        application: 'audio',
        packetlossperc: 5,
        useinbandfec: true,
        usedtx: false,
        signal: 'music',
        complexity: 8,
      });
    });

    it('should strip unknown fields from Opus config', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: {
          packetlossperc: 10,
          unknownField: 'should be stripped',
        } as any,
      });

      expect(support.supported).toBe(true);
      expect(support.config.opus?.packetlossperc).toBe(10);
      expect((support.config.opus as any)?.unknownField).toBeUndefined();
    });
  });

  describe('AAC codec-specific config', () => {
    it('should accept AAC config with format', async () => {
      const supportAac = await AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        aac: { format: 'aac' },
      });
      expect(supportAac.supported).toBe(true);
      expect(supportAac.config.aac?.format).toBe('aac');

      const supportAdts = await AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        aac: { format: 'adts' },
      });
      expect(supportAdts.supported).toBe(true);
      expect(supportAdts.config.aac?.format).toBe('adts');
    });

    it('should strip unknown fields from AAC config', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        aac: {
          format: 'aac',
          unknownField: 'should be stripped',
        } as any,
      });

      expect(support.supported).toBe(true);
      expect(support.config.aac?.format).toBe('aac');
      expect((support.config.aac as any)?.unknownField).toBeUndefined();
    });

    it('should throw TypeError for invalid AAC format', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        aac: { format: 'invalid' as any },
      })).rejects.toThrow(TypeError);
    });
  });

  describe('isConfigSupported TypeError validation (N10 fix)', () => {
    it('should throw TypeError for missing codec', async () => {
      await expect(AudioEncoder.isConfigSupported({
        sampleRate: 48000,
        numberOfChannels: 2,
      } as any)).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for empty codec string', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: '',
        sampleRate: 48000,
        numberOfChannels: 2,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for missing sampleRate', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        numberOfChannels: 2,
      } as any)).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for non-positive sampleRate', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 0,
        numberOfChannels: 2,
      })).rejects.toThrow(TypeError);

      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: -1,
        numberOfChannels: 2,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for non-finite sampleRate', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: NaN,
        numberOfChannels: 2,
      })).rejects.toThrow(TypeError);

      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: Infinity,
        numberOfChannels: 2,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for missing numberOfChannels', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
      } as any)).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for non-integer numberOfChannels', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2.5,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for non-positive numberOfChannels', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 0,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for invalid bitrateMode', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrateMode: 'invalid' as any,
      })).rejects.toThrow(TypeError);
    });

    it('should throw TypeError for invalid latencyMode', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        latencyMode: 'invalid' as any,
      })).rejects.toThrow(TypeError);
    });
  });

  describe('Opus bitrate bounds validation (N10 fix)', () => {
    it('should return supported:false for Opus bitrate below 6kbps', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 5000, // Below 6kbps minimum
      });
      expect(support.supported).toBe(false);
    });

    it('should return supported:false for Opus bitrate above 510kbps', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 520000, // Above 510kbps maximum
      });
      expect(support.supported).toBe(false);
    });

    it('should accept Opus bitrate at boundaries', async () => {
      const supportMin = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 6000, // Exactly 6kbps
      });
      expect(supportMin.supported).toBe(true);

      const supportMax = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 510000, // Exactly 510kbps
      });
      expect(supportMax.supported).toBe(true);
    });

    it('should return supported:false for Opus with >255 channels', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 256,
      });
      expect(support.supported).toBe(false);
    });
  });

  describe('Opus format validation (N10 fix)', () => {
    it('should accept opus.format = opus', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { format: 'opus' },
      });
      expect(support.supported).toBe(true);
      expect(support.config.opus?.format).toBe('opus');
    });

    it('should accept opus.format = ogg', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { format: 'ogg' },
      });
      expect(support.supported).toBe(true);
      expect(support.config.opus?.format).toBe('ogg');
    });

    it('should throw TypeError for invalid opus.format', async () => {
      await expect(AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        opus: { format: 'invalid' as any },
      })).rejects.toThrow(TypeError);
    });

    it('should fill default opus.format when not provided', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      expect(support.supported).toBe(true);
      expect(support.config.opus?.format).toBe('opus');
    });
  });

  describe('Opus defaults (N10 fix)', () => {
    it('should fill all Opus defaults when no opus config provided', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
      expect(support.config.opus).toEqual({
        format: 'opus',
        frameDuration: 20000,
        application: 'audio',
        packetlossperc: 0,
        useinbandfec: false,
        usedtx: false,
        signal: 'auto',
        complexity: 10,
      });
    });
  });
});
