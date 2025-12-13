import { EventEmitter } from 'events';

export interface EncoderBackend extends EventEmitter {
  startEncoder(config: any): void;
  write(data: Buffer | Uint8Array): boolean;
  end(): void;
  shutdown(timeout?: number): Promise<void>;
  kill(): void;
  readonly isHealthy: boolean;
}

export interface DecoderBackend extends EventEmitter {
  startDecoder(config: any): void;
  write?(data: Buffer | Uint8Array): boolean;
  decode?(data: Buffer | Uint8Array): boolean;
  end(): void;
  shutdown(timeout?: number): Promise<void>;
  kill(): void;
  readonly isHealthy: boolean;
}
