/**
 * AudioDecoder type definitions
 */

import type { AudioSampleFormat } from '../../core/AudioData.js';

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
  outputFormat?: AudioSampleFormat;
}

export interface AudioDecoderInit {
  output: (data: import('../../core/AudioData.js').AudioData) => void;
  error: (error: Error) => void;
}

export interface AudioDecoderSupport {
  supported: boolean;
  config: AudioDecoderConfig;
}
