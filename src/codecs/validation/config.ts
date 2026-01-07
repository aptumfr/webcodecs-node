/**
 * Decoder/Encoder configuration validation
 *
 * These functions validate config objects for TypeError conditions
 * (missing/invalid required fields) before checking codec support.
 */

/**
 * Check if a video decoder config is valid (throws TypeError if invalid)
 * This checks for missing/empty required fields
 */
export function validateVideoDecoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }

  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }

  // Validate codedWidth if provided
  if (cfg.codedWidth !== undefined) {
    if (typeof cfg.codedWidth !== 'number' || !Number.isFinite(cfg.codedWidth) || cfg.codedWidth <= 0 || !Number.isInteger(cfg.codedWidth)) {
      throw new TypeError('codedWidth must be a positive integer');
    }
  }

  // Validate codedHeight if provided
  if (cfg.codedHeight !== undefined) {
    if (typeof cfg.codedHeight !== 'number' || !Number.isFinite(cfg.codedHeight) || cfg.codedHeight <= 0 || !Number.isInteger(cfg.codedHeight)) {
      throw new TypeError('codedHeight must be a positive integer');
    }
  }

  // Validate displayAspectWidth if provided
  if (cfg.displayAspectWidth !== undefined) {
    if (typeof cfg.displayAspectWidth !== 'number' || !Number.isFinite(cfg.displayAspectWidth) || cfg.displayAspectWidth <= 0 || !Number.isInteger(cfg.displayAspectWidth)) {
      throw new TypeError('displayAspectWidth must be a positive integer');
    }
  }

  // Validate displayAspectHeight if provided
  if (cfg.displayAspectHeight !== undefined) {
    if (typeof cfg.displayAspectHeight !== 'number' || !Number.isFinite(cfg.displayAspectHeight) || cfg.displayAspectHeight <= 0 || !Number.isInteger(cfg.displayAspectHeight)) {
      throw new TypeError('displayAspectHeight must be a positive integer');
    }
  }
}

/**
 * Check if a video encoder config is valid (throws TypeError if invalid)
 *
 * This is the single source of truth for VideoEncoderConfig validation.
 * Both isConfigSupported() and configure() use this function.
 */
export function validateVideoEncoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Required: codec (non-empty string)
  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }
  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }

  // Required: width (positive integer per WebCodecs spec)
  if (cfg.width === undefined || cfg.width === null) {
    throw new TypeError('width is required');
  }
  if (typeof cfg.width !== 'number' || cfg.width <= 0 || !Number.isInteger(cfg.width)) {
    throw new TypeError('width must be a positive integer');
  }

  // Required: height (positive integer per WebCodecs spec)
  if (cfg.height === undefined || cfg.height === null) {
    throw new TypeError('height is required');
  }
  if (typeof cfg.height !== 'number' || cfg.height <= 0 || !Number.isInteger(cfg.height)) {
    throw new TypeError('height must be a positive integer');
  }

  // Optional: displayWidth (positive number)
  if (cfg.displayWidth !== undefined && (typeof cfg.displayWidth !== 'number' || cfg.displayWidth <= 0)) {
    throw new TypeError('displayWidth must be a positive number');
  }

  // Optional: displayHeight (positive number)
  if (cfg.displayHeight !== undefined && (typeof cfg.displayHeight !== 'number' || cfg.displayHeight <= 0)) {
    throw new TypeError('displayHeight must be a positive number');
  }

  // Optional: bitrate (positive number)
  if (cfg.bitrate !== undefined && (typeof cfg.bitrate !== 'number' || cfg.bitrate <= 0)) {
    throw new TypeError('bitrate must be a positive number');
  }

  // Optional: framerate (positive number)
  if (cfg.framerate !== undefined && (typeof cfg.framerate !== 'number' || cfg.framerate <= 0)) {
    throw new TypeError('framerate must be a positive number');
  }
}

/**
 * Check if an audio decoder config is valid (throws TypeError if invalid)
 */
export function validateAudioDecoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }

  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }

  if (cfg.sampleRate === undefined || cfg.sampleRate === null) {
    throw new TypeError('sampleRate is required');
  }

  if (typeof cfg.sampleRate !== 'number' || cfg.sampleRate <= 0 || !Number.isFinite(cfg.sampleRate)) {
    throw new TypeError('sampleRate must be a positive number');
  }

  if (cfg.numberOfChannels === undefined || cfg.numberOfChannels === null) {
    throw new TypeError('numberOfChannels is required');
  }

  if (typeof cfg.numberOfChannels !== 'number' || cfg.numberOfChannels <= 0 || !Number.isInteger(cfg.numberOfChannels)) {
    throw new TypeError('numberOfChannels must be a positive integer');
  }
}

/**
 * Check if an audio encoder config is valid (throws TypeError if invalid)
 */
export function validateAudioEncoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }

  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }

  if (cfg.sampleRate === undefined || cfg.sampleRate === null) {
    throw new TypeError('sampleRate is required');
  }

  if (typeof cfg.sampleRate !== 'number' || cfg.sampleRate <= 0 || !Number.isFinite(cfg.sampleRate)) {
    throw new TypeError('sampleRate must be a positive number');
  }

  if (cfg.numberOfChannels === undefined || cfg.numberOfChannels === null) {
    throw new TypeError('numberOfChannels is required');
  }

  if (typeof cfg.numberOfChannels !== 'number' || cfg.numberOfChannels <= 0 || !Number.isInteger(cfg.numberOfChannels)) {
    throw new TypeError('numberOfChannels must be a positive integer');
  }

  // Optional field validations
  if (cfg.bitrate !== undefined && (typeof cfg.bitrate !== 'number' || cfg.bitrate <= 0)) {
    throw new TypeError('bitrate must be a positive number');
  }
}
