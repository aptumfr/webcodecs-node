/**
 * ImageTrack and ImageTrackList implementations
 */

/**
 * ImageTrack - Represents an individual image track
 */
export class ImageTrack {
  private _animated: boolean;
  private _frameCount: number;
  private _repetitionCount: number;
  private _selected: boolean;
  private _trackList: ImageTrackList | null = null;
  private _index: number = -1;

  constructor(options: {
    animated: boolean;
    frameCount: number;
    repetitionCount: number;
    selected: boolean;
  }) {
    this._animated = options.animated;
    this._frameCount = options.frameCount;
    this._repetitionCount = options.repetitionCount;
    this._selected = options.selected;
  }

  get animated(): boolean { return this._animated; }
  get frameCount(): number { return this._frameCount; }
  get repetitionCount(): number { return this._repetitionCount; }
  get selected(): boolean { return this._selected; }

  /**
   * Set the selected state of this track.
   * Setting to true deselects any previously selected track.
   * Per WebCodecs spec, this allows switching between tracks.
   */
  set selected(value: boolean) {
    if (value === this._selected) return;

    if (value && this._trackList) {
      // Deselect the currently selected track
      this._trackList._deselectAll();
      this._selected = true;
      this._trackList._updateSelectedIndex(this._index);
    } else {
      this._selected = value;
      if (!value && this._trackList) {
        this._trackList._updateSelectedIndex(-1);
      }
    }
  }

  /** @internal */
  _setTrackList(trackList: ImageTrackList, index: number): void {
    this._trackList = trackList;
    this._index = index;
  }
}

/**
 * ImageTrackList - A list of image tracks
 * Uses a Proxy to support bracket notation (tracks[0]) at runtime
 */
class ImageTrackListImpl {
  private _tracks: ImageTrack[] = [];
  private _selectedIndex: number = -1;
  private _ready: Promise<void>;
  private _resolveReady!: () => void;

  constructor() {
    this._ready = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  get ready(): Promise<void> { return this._ready; }
  get length(): number { return this._tracks.length; }
  get selectedIndex(): number { return this._selectedIndex; }

  get selectedTrack(): ImageTrack | null {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._tracks.length) {
      return this._tracks[this._selectedIndex];
    }
    return null;
  }

  /** @internal */
  _addTrack(track: ImageTrack): void {
    const index = this._tracks.length;
    this._tracks.push(track);
    track._setTrackList(this as unknown as ImageTrackList, index);
    if (track.selected && this._selectedIndex === -1) {
      this._selectedIndex = index;
    }
  }

  /** @internal */
  _markReady(): void {
    this._resolveReady();
  }

  /** @internal - Deselect all tracks (called when selecting a new track) */
  _deselectAll(): void {
    for (const track of this._tracks) {
      (track as any)._selected = false;
    }
  }

  /** @internal - Update the selected index */
  _updateSelectedIndex(index: number): void {
    this._selectedIndex = index;
  }

  /**
   * Get track by index
   */
  get(index: number): ImageTrack | undefined {
    return this._tracks[index];
  }

  [Symbol.iterator](): Iterator<ImageTrack> {
    return this._tracks[Symbol.iterator]();
  }
}

/**
 * ImageTrackList interface with numeric indexing support
 */
export interface ImageTrackList extends ImageTrackListImpl {
  [index: number]: ImageTrack | undefined;
}

/**
 * Create an ImageTrackList with Proxy for bracket notation support
 * Per WebCodecs spec, tracks[0] should work at runtime
 */
export function createImageTrackList(): ImageTrackList {
  const impl = new ImageTrackListImpl();
  return new Proxy(impl, {
    get(target, prop, receiver) {
      // Handle numeric string properties (e.g., "0", "1")
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        return target.get(parseInt(prop, 10));
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const index = parseInt(prop, 10);
        return index >= 0 && index < target.length;
      }
      return Reflect.has(target, prop);
    },
  }) as ImageTrackList;
}

// For backwards compatibility, also export a class that creates the proxy
export const ImageTrackListClass = class {
  constructor() {
    return createImageTrackList();
  }
} as unknown as { new(): ImageTrackList };
