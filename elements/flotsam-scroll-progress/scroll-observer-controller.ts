import type { ReactiveController, ReactiveElement } from 'lit';

export class ScrollObserverController implements ReactiveController {
  #host: ReactiveElement;
  #target: Element | null = null;
  #resizeObserver?: ResizeObserver;
  #rafId = 0;
  #progress = 0;
  #selector?: string;

  get progress(): number {
    return this.#progress;
  }

  constructor(host: ReactiveElement, selector?: string) {
    this.#host = host;
    this.#selector = selector;
    host.addController(this);
  }

  set selector(value: string | undefined) {
    if (this.#selector !== value) {
      this.#selector = value;
      this.#disconnect();
      this.#connect();
    }
  }

  hostConnected(): void {
    this.#connect();
  }

  hostDisconnected(): void {
    this.#disconnect();
  }

  #connect(): void {
    const resolved = this.#resolveTarget();
    if (!resolved) {
      return;
    }
    this.#target = resolved;

    const scrollTarget = this.#scrollEventTarget;
    scrollTarget.addEventListener('scroll', this.#onScroll, { passive: true });

    this.#resizeObserver = new ResizeObserver(this.#onResize);
    this.#resizeObserver.observe(this.#target);

    this.#update();
  }

  #disconnect(): void {
    const scrollTarget = this.#target ? this.#scrollEventTarget : null;
    scrollTarget?.removeEventListener('scroll', this.#onScroll);
    this.#resizeObserver?.disconnect();
    cancelAnimationFrame(this.#rafId);
    this.#target = null;
  }

  #resolveTarget(): Element | null {
    if (this.#selector) {
      return document.querySelector(this.#selector);
    }
    return document.documentElement;
  }

  /** Scroll events fire on `document` for the documentElement, on the element itself otherwise. */
  get #scrollEventTarget(): EventTarget {
    return this.#target === document.documentElement ? document : this.#target!;
  }

  #onScroll = (): void => {
    this.#scheduleUpdate();
  };

  #onResize = (): void => {
    this.#scheduleUpdate();
  };

  #scheduleUpdate(): void {
    cancelAnimationFrame(this.#rafId);
    this.#rafId = requestAnimationFrame(() => this.#update());
  }

  #update(): void {
    if (!this.#target) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = this.#target;
    const max = scrollHeight - clientHeight;
    const next = max <= 0 ? 0 : Math.min(1, Math.max(0, scrollTop / max));
    if (next !== this.#progress) {
      this.#progress = next;
      this.#host.requestUpdate();
    }
  }
}
