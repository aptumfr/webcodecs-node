/**
 * EventTarget mixin for WebCodecs classes
 * Provides addEventListener/removeEventListener/dispatchEvent compatibility
 * while extending Node.js EventEmitter
 */

import { EventEmitter } from 'events';

export interface EventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

export type EventListener = (event: Event | { type: string }) => void;

/**
 * WebCodecsEventTarget - Base class that extends EventEmitter
 * and provides EventTarget-compatible methods
 */
export class WebCodecsEventTarget extends EventEmitter {
  private _eventListeners: Map<string, Set<{ listener: EventListener; once: boolean }>> = new Map();

  /**
   * Add an event listener (EventTarget-compatible)
   */
  addEventListener(
    type: string,
    listener: EventListener | null,
    options?: boolean | EventListenerOptions
  ): void {
    if (!listener) return;

    const once = typeof options === 'object' ? options.once ?? false : false;

    // Store listener for removeEventListener
    if (!this._eventListeners.has(type)) {
      this._eventListeners.set(type, new Set());
    }
    this._eventListeners.get(type)!.add({ listener, once });

    // Create wrapper that calls with Event-like object
    const wrapper = (...args: unknown[]) => {
      const eventData = typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
      const event = { type, target: this, ...(eventData as Record<string, unknown>) };
      listener(event);

      if (once) {
        this._eventListeners.get(type)?.forEach((entry) => {
          if (entry.listener === listener) {
            this._eventListeners.get(type)?.delete(entry);
          }
        });
      }
    };

    // Store reference to wrapper for removal
    (listener as any)._wrapper = wrapper;

    if (once) {
      this.once(type, wrapper);
    } else {
      this.on(type, wrapper);
    }

    // Handle abort signal
    if (typeof options === 'object' && options.signal) {
      options.signal.addEventListener('abort', () => {
        this.removeEventListener(type, listener);
      });
    }
  }

  /**
   * Remove an event listener (EventTarget-compatible)
   */
  removeEventListener(
    type: string,
    listener: EventListener | null,
    _options?: boolean | EventListenerOptions
  ): void {
    if (!listener) return;

    // Remove from our tracking
    this._eventListeners.get(type)?.forEach((entry) => {
      if (entry.listener === listener) {
        this._eventListeners.get(type)?.delete(entry);
      }
    });

    // Remove the wrapper from EventEmitter
    const wrapper = (listener as any)._wrapper;
    if (wrapper) {
      this.off(type, wrapper);
    }
  }

  /**
   * Dispatch an event (EventTarget-compatible)
   */
  dispatchEvent(event: Event | { type: string }): boolean {
    const type = event.type;
    this.emit(type, event);
    return true;
  }

  /**
   * Event handler property support (e.g., ondequeue)
   */
  protected _setEventHandler(type: string, handler: EventListener | null): void {
    const existingHandler = (this as any)[`_on${type}Handler`];
    if (existingHandler) {
      this.removeEventListener(type, existingHandler);
    }

    if (handler) {
      (this as any)[`_on${type}Handler`] = handler;
      this.addEventListener(type, handler);
    }
  }

  protected _getEventHandler(type: string): EventListener | null {
    return (this as any)[`_on${type}Handler`] ?? null;
  }
}
