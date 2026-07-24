import type { ScrollObserverController } from './scroll-observer-controller.js';

import { LitElement, html, isServer } from 'lit';
import { customElement } from 'lit/decorators/custom-element.js';
import { property } from 'lit/decorators/property.js';

import styles from './flotsam-scroll-progress.css' with { type: 'css' };

@customElement('flotsam-scroll-progress')
export class FlotsamScrollProgress extends LitElement {
  static readonly styles = [styles];

  #observer?: ScrollObserverController;

  /** Orientation of the progress indicator. */
  @property({ reflect: true }) orientation: 'horizontal' | 'vertical' = 'horizontal';

  /** CSS selector for the scroll container to observe. Defaults to the document scrolling element. */
  @property() target?: string;

  /** Current scroll progress as a percentage (0–100). Read-only; derived from scroll position. */
  get value(): number {
    return Math.round((this.#observer?.progress ?? 0) * 100);
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (!isServer) {
      this.#initObserver();
    }
  }

  async #initObserver(): Promise<void> {
    const { ScrollObserverController } = await import('./scroll-observer-controller.js');
    this.#observer ??= new ScrollObserverController(this, this.target);
  }

  protected updated(): void {
    if (this.#observer) {
      this.#observer.selector = this.target;
    }
    this.style.setProperty('--_progress', String(this.#observer?.progress ?? 0));
    this.setAttribute('value', String(this.value));
  }

  render() {
    return html`
      <div id="track" part="track">
        <div id="fill" part="fill"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'flotsam-scroll-progress': FlotsamScrollProgress;
  }
}
