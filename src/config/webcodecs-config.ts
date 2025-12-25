/**
 * Unified WebCodecs configuration
 *
 * Loads configuration from webcodecs-config.js (or WEBCODECS_CONFIG env var).
 * All settings are optional - omit or comment out to use defaults.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { HardwareAccelerationMethod } from '../hardware/types.js';

/**
 * Per-codec configuration overrides
 */
export interface CodecConfig {
  /** CRF value for quality-based encoding */
  crf?: number;
  /** Encoder preset (e.g., 'fast', 'medium', 'slow') */
  preset?: string;
  /** Hardware acceleration priority order for this codec */
  hwaccel?: HardwareAccelerationMethod[];
}

/**
 * WebCodecs configuration options
 */
export interface WebCodecsConfig {
  /** Global CRF value (overridden by perCodec) */
  crf?: number;
  /** Global encoder preset (overridden by perCodec) */
  preset?: string;
  /** Global hardware acceleration priority order (overridden by perCodec) */
  hwaccel?: HardwareAccelerationMethod[];
  /** Per-codec overrides */
  perCodec?: Record<string, CodecConfig>;
}

const DEFAULT_CONFIG: WebCodecsConfig = {};

let cachedConfig: WebCodecsConfig | null = null;

/**
 * Validate and sanitize raw config object
 */
function sanitizeConfig(raw: unknown): WebCodecsConfig {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_CONFIG;
  }

  const src = raw as Record<string, unknown>;
  const config: WebCodecsConfig = {};

  // Global quality settings
  if (typeof src.crf === 'number') {
    config.crf = src.crf;
  }
  if (typeof src.preset === 'string') {
    config.preset = src.preset;
  }

  // Global hwaccel order
  if (Array.isArray(src.hwaccel)) {
    config.hwaccel = src.hwaccel.filter(
      (m): m is HardwareAccelerationMethod => typeof m === 'string'
    );
  }

  // Per-codec overrides
  if (src.perCodec && typeof src.perCodec === 'object') {
    config.perCodec = {};
    for (const [codec, codecConfig] of Object.entries(src.perCodec as Record<string, unknown>)) {
      if (codecConfig && typeof codecConfig === 'object') {
        const cc = codecConfig as Record<string, unknown>;
        const parsed: CodecConfig = {};

        if (typeof cc.crf === 'number') {
          parsed.crf = cc.crf;
        }
        if (typeof cc.preset === 'string') {
          parsed.preset = cc.preset;
        }
        if (Array.isArray(cc.hwaccel)) {
          parsed.hwaccel = cc.hwaccel.filter(
            (m): m is HardwareAccelerationMethod => typeof m === 'string'
          );
        }

        if (Object.keys(parsed).length > 0) {
          config.perCodec[codec.toLowerCase()] = parsed;
        }
      }
    }
  }

  return config;
}

/**
 * Load configuration from file
 */
async function loadConfig(): Promise<WebCodecsConfig> {
  // Check for config file path in env
  if (process.env.WEBCODECS_CONFIG) {
    const configPath = process.env.WEBCODECS_CONFIG;
    if (fs.existsSync(configPath)) {
      try {
        const mod = await import(pathToFileURL(configPath).href);
        const raw = mod?.default ?? mod?.webCodecsConfig ?? mod;
        return sanitizeConfig(raw);
      } catch {
        // Fall through to defaults
      }
    }
    return DEFAULT_CONFIG;
  }

  // Try new unified config file first
  const newConfigPath = path.join(process.cwd(), 'webcodecs-config.js');
  if (fs.existsSync(newConfigPath)) {
    try {
      const mod = await import(pathToFileURL(newConfigPath).href);
      const raw = mod?.default ?? mod?.webCodecsConfig ?? mod;
      return sanitizeConfig(raw);
    } catch {
      // Fall through to legacy config
    }
  }

  // Fallback: try legacy ffmpeg-quality.js for backwards compatibility
  const legacyConfigPath = process.env.WEB_CODECS_FFMPEG_QUALITY
    ?? path.join(process.cwd(), 'ffmpeg-quality.js');
  if (fs.existsSync(legacyConfigPath)) {
    try {
      const mod = await import(pathToFileURL(legacyConfigPath).href);
      const raw = mod?.default ?? mod?.ffmpegQuality ?? mod;
      return sanitizeConfig(raw);
    } catch {
      // Fall through to defaults
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Get the loaded configuration (cached)
 */
export async function getConfig(): Promise<WebCodecsConfig> {
  if (cachedConfig === null) {
    cachedConfig = await loadConfig();
  }
  return cachedConfig;
}

/**
 * Get configuration synchronously (returns cached or empty)
 * Call getConfig() first to ensure config is loaded
 */
export function getConfigSync(): WebCodecsConfig {
  return cachedConfig ?? DEFAULT_CONFIG;
}

/**
 * Clear cached config (for testing or reloading)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get quality settings for a specific codec
 */
export function getQualityConfig(codecName: string): { crf?: number; preset?: string } {
  const config = getConfigSync();
  const key = codecName.toLowerCase();
  const perCodec = config.perCodec?.[key];

  return {
    crf: perCodec?.crf ?? config.crf,
    preset: perCodec?.preset ?? config.preset,
  };
}

/**
 * Get hardware acceleration priority order for a specific codec
 * Returns undefined if no override is configured (use default priorities)
 * Returns empty array if explicitly set to [] (force software encoding)
 */
export function getHwaccelConfig(codecName: string): HardwareAccelerationMethod[] | undefined {
  const config = getConfigSync();
  const key = codecName.toLowerCase();

  // Per-codec hwaccel takes precedence (including empty array)
  const perCodec = config.perCodec?.[key]?.hwaccel;
  if (perCodec !== undefined) {
    return perCodec;
  }

  // Fall back to global hwaccel (including empty array)
  if (config.hwaccel !== undefined) {
    return config.hwaccel;
  }

  // No override - use default priorities
  return undefined;
}

// Load config on module init
export const webCodecsConfig = await loadConfig();
cachedConfig = webCodecsConfig;
