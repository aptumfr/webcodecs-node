/**
 * Hardware capabilities configuration
 */

import type { HardwareType, HardwareFormatCapabilities } from './types.js';

/**
 * Known capabilities for each hardware type
 * These are the theoretical capabilities - actual support depends on driver version
 */
export const HARDWARE_CAPABILITIES: Record<HardwareType, HardwareFormatCapabilities> = {
  cuda: {
    scaleFilter: 'scale_cuda',
    gpuOutputFormats: ['nv12', 'yuv420p', 'p010le', 'yuv444p', 'bgra', 'rgba'],
    supportsRgbOutput: true,
  },
  vaapi: {
    scaleFilter: 'scale_vaapi',
    gpuOutputFormats: ['nv12', 'p010'],
    supportsRgbOutput: false,
  },
  qsv: {
    scaleFilter: 'vpp_qsv',  // vpp_qsv is more capable than scale_qsv
    gpuOutputFormats: ['nv12', 'p010', 'bgra'],  // bgra on some drivers
    supportsRgbOutput: false,  // Conservative - driver dependent
  },
  videotoolbox: {
    scaleFilter: 'scale_vt',
    gpuOutputFormats: ['nv12', 'p010', 'bgra'],
    supportsRgbOutput: true,
  },
  drm: {
    scaleFilter: '',  // No GPU scale filter for DRM
    gpuOutputFormats: ['nv12'],
    supportsRgbOutput: false,
  },
  v4l2m2m: {
    scaleFilter: '',  // No GPU scale filter for V4L2
    gpuOutputFormats: ['nv12', 'yuv420p'],
    supportsRgbOutput: false,
  },
  software: {
    scaleFilter: '',
    gpuOutputFormats: [],
    supportsRgbOutput: false,
  },
};
