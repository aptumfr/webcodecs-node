/**
 * Encoder setup utilities
 *
 * Handles encoder codec selection (hardware vs software)
 * and hardware context management.
 */

import type { HardwareContext } from 'node-av/api';
import type { FFEncoderCodec } from 'node-av/constants';

import { getBestEncoderSync } from '../../../../hardware/index.js';
import { acquireHardwareContext, releaseHardwareContext } from '../../../../utils/hardware-pool.js';
import { createLogger } from '../../../../utils/logger.js';
import { getSoftwareEncoder } from './software-encoders.js';
import { getHardwareMinResolution } from './hardware-constraints.js';

const logger = createLogger('encoder-setup');

/** Encoder codec type - FFEncoderCodec string or any hardware codec object */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EncoderCodec = FFEncoderCodec | any;

export interface EncoderSelection {
  /** The FFmpeg encoder codec to use */
  encoderCodec: EncoderCodec;
  /** Whether this is a hardware encoder */
  isHardware: boolean;
  /** Hardware context if using hardware acceleration */
  hardware: HardwareContext | null;
}

/**
 * Select the best encoder codec based on configuration
 *
 * Tries hardware encoder first if available and resolution meets minimum requirements,
 * falls back to software encoder otherwise.
 */
export async function selectEncoderCodec(
  codecName: string,
  width: number,
  height: number,
  hardwarePreference?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
): Promise<EncoderSelection> {
  // Use the unified hardware detection system which respects webcodecs-config.js
  const bestEncoder = getBestEncoderSync(codecName as any, hardwarePreference);

  if (bestEncoder.isHardware && bestEncoder.hwaccel) {
    // Check if resolution meets hardware encoder minimum requirements
    // VAAPI/QSV have known minimum constraints that vary by codec
    const minSize = getHardwareMinResolution(bestEncoder.hwaccel, codecName);
    if (width < minSize.width || height < minSize.height) {
      logger.info(
        `Resolution ${width}x${height} below hardware minimum ${minSize.width}x${minSize.height}, using software encoder`
      );
    } else {
      try {
        // Use pooled hardware context
        const hardware = acquireHardwareContext(bestEncoder.hwaccel);
        if (hardware) {
          const hwCodec = hardware.getEncoderCodec(codecName as any);
          if (hwCodec) {
            logger.info(`Using hardware encoder: ${bestEncoder.encoder} (${hardware.deviceTypeName})`);
            return { encoderCodec: hwCodec, isHardware: true, hardware };
          }
        }
      } catch {
        // Fall through to software if hardware failed
      }
      logger.warn(`Hardware encoder ${bestEncoder.encoder} failed, falling back to software`);
    }
  }

  const softwareCodec = getSoftwareEncoder(codecName);
  logger.info(`Using software encoder: ${softwareCodec}`);
  return { encoderCodec: softwareCodec as FFEncoderCodec, isHardware: false, hardware: null };
}

/**
 * Handle hardware encoder failure by falling back to software
 */
export function fallbackToSoftware(
  codecName: string,
  hardware: HardwareContext | null
): { encoderCodec: FFEncoderCodec; hardware: null } {
  if (hardware) {
    releaseHardwareContext(hardware);
  }
  const softwareCodec = getSoftwareEncoder(codecName);
  logger.info(`Falling back to software encoder: ${softwareCodec}`);
  return { encoderCodec: softwareCodec as FFEncoderCodec, hardware: null };
}
