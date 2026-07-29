import { LitElement, html, isServer, nothing } from 'lit';
import { customElement } from 'lit/decorators/custom-element.js';
import { property } from 'lit/decorators/property.js';
import { query } from 'lit/decorators/query.js';
import { state } from 'lit/decorators/state.js';
import { styleMap } from 'lit/directives/style-map.js';

import styles from './flotsam-page-reader.css' with { type: 'css' };

const HIGHLIGHT_NAME = 'flotsam-page-reader';

interface Segment {
  text: string;
  element: Element;
}

/**
 * A page reader that reads content aloud using the Web Speech Synthesis
 * API. Point it at a content container via the `target` attribute and it
 * extracts readable text elements, synthesizes speech one paragraph at a
 * time, highlights the active element via the CSS Custom Highlight API,
 * and optionally auto-scrolls to keep it in view.
 *
 * Include the shipped light-DOM stylesheet for default highlight styles:
 * ```html
 * <link rel="stylesheet" href="flotsam-page-reader-lightdom.css">
 * ```
 *
 * Override the highlight color by redefining `::highlight(flotsam-page-reader)`
 * in your own stylesheet.
 *
 * @summary Read-aloud page reader using Web Speech Synthesis.
 *
 * @cssprop {<color>} --flotsam-color-interactive-default - Primary interactive
 *   color used for hover/pressed backgrounds and the progress fill.
 * @cssprop {<color>} --flotsam-color-interactive-text - Text color on
 *   interactive backgrounds.
 * @cssprop {<color>} --flotsam-color-surface-subtle - Track background color.
 * @cssprop {<color>} --flotsam-color-focus - Focus ring color.
 *
 * @fires {Event} flotsam-page-reader-end - Fires when speech playback
 *   completes naturally (not on stop).
 */
@customElement('flotsam-page-reader')
export class FlotsamPageReader extends LitElement {
  static readonly styles = [styles];

  /** CSS selector for the content element whose text will be read aloud. */
  @property() target?: string;

  /** Visible label displayed before the transport controls. */
  @property() label = 'Read aloud';

  /** Preferred voice name. Falls back to the default voice for the page language. */
  @property() voice?: string;

  @state() _playing = false;
  @state() _paused = false;
  @state() _rate = 1;
  @state() _autoScroll = true;
  @state() _currentIndex = -1;
  @state() _totalSegments = 0;

  @state() _announcement = '';

  @query('#play') private _playButton!: HTMLButtonElement;

  #segments: Segment[] = [];
  #supported = true;
  #prefersReducedMotion = false;
  #highlight: Highlight | null = null;

  get #progress(): number {
    if (this._totalSegments === 0 || this._currentIndex < 0) return 0;
    return (this._currentIndex + 1) / this._totalSegments;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!isServer) {
      this.#supported = 'speechSynthesis' in window;
      this.#prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!this.hasAttribute('role')) {
        this.setAttribute('role', 'toolbar');
      }
      this.setAttribute('aria-label', this.label);
      if ('highlights' in CSS) {
        this.#highlight = new Highlight();
        CSS.highlights.set(HIGHLIGHT_NAME, this.#highlight);
      }
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('label')) {
      this.setAttribute('aria-label', this.label);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (!isServer && this.#supported) {
      this.#stop();
    }
    if (this.#highlight) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      this.#highlight = null;
    }
  }

  #extractSegments(): void {
    if (!this.target) return;
    const container = document.querySelector(this.target);
    if (!container) return;

    const selector =
      'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd';
    const elements = [...container.querySelectorAll(selector)];

    this.#segments = elements
      .map(el => ({ text: (el.textContent ?? '').trim(), element: el }))
      .filter(s => s.text.length > 0);

    this._totalSegments = this.#segments.length;
  }

  #resolveVoice(): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices();
    if (this.voice) {
      return voices.find(v => v.name === this.voice) ?? null;
    }
    const lang =
      this.closest('[lang]')?.getAttribute('lang')
      ?? document.documentElement.lang
      ?? 'en';
    return voices.find(v => v.lang.startsWith(lang)) ?? null;
  }

  #play(): void {
    if (this._paused) {
      this._paused = false;
      this._playing = true;
      speechSynthesis.resume();
      return;
    }

    this.#extractSegments();
    if (this.#segments.length === 0) return;

    this._currentIndex = 0;
    this._playing = true;
    this.#speakCurrent();
  }

  #speakCurrent(): void {
    if (this._currentIndex >= this.#segments.length) {
      this.#complete();
      return;
    }

    const segment = this.#segments[this._currentIndex];
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.rate = this._rate;

    const voice = this.#resolveVoice();
    if (voice) utterance.voice = voice;

    utterance.addEventListener('end', () => {
      if (!this._playing) return;
      this.#clearHighlight();
      this._currentIndex++;
      this.#speakCurrent();
    });

    utterance.addEventListener('error', (e: SpeechSynthesisErrorEvent) => {
      if (e.error === 'canceled') return;
      this.#complete();
    });

    this.#highlightCurrent();
    speechSynthesis.speak(utterance);
  }

  #pause(): void {
    this._playing = false;
    this._paused = true;
    speechSynthesis.pause();
  }

  #stop(): void {
    this._playing = false;
    this._paused = false;
    this._currentIndex = -1;
    this._totalSegments = 0;
    speechSynthesis.cancel();
    this.#clearHighlight();
  }

  #complete(): void {
    this._playing = false;
    this._paused = false;
    this._currentIndex = -1;
    this._totalSegments = 0;
    this.#clearHighlight();
    this.dispatchEvent(
      new Event('flotsam-page-reader-end', { bubbles: true, composed: true }),
    );
  }

  #toggle = (): void => {
    if (this._playing) {
      this.#pause();
    } else {
      this.#play();
    }
  };

  #handleStop = async (): Promise<void> => {
    this.#stop();
    await this.updateComplete;
    this._playButton?.focus();
  };

  #cycleRate = (): void => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const idx = rates.indexOf(this._rate);
    this._rate = rates[(idx + 1) % rates.length];
    this.#announce(`Speed: ${this._rate}x`);
  };

  #toggleAutoScroll = (): void => {
    this._autoScroll = !this._autoScroll;
  };

  #announce(message: string): void {
    this._announcement = '';
    requestAnimationFrame(() => {
      this._announcement = message;
    });
  }

  #highlightCurrent(): void {
    this.#clearHighlight();
    const seg = this.#segments[this._currentIndex];
    if (!seg) return;
    if (this.#highlight) {
      const range = new Range();
      range.selectNodeContents(seg.element);
      this.#highlight.add(range);
    }
    if (this._autoScroll) {
      seg.element.scrollIntoView({
        behavior: this.#prefersReducedMotion ? 'instant' : 'smooth',
        block: 'center',
      });
    }
  }

  #clearHighlight(): void {
    this.#highlight?.clear();
  }

  override render() {
    if (!this.#supported) return nothing;

    const { _playing: playing, _paused: paused, _rate: rate, _autoScroll: autoScroll } = this;
    const total = this._totalSegments;
    const current = this._currentIndex >= 0 ? this._currentIndex + 1 : 0;

    const playIcon = playing
      ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : html`<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>`;

    return html`
      <div id="container">
      <span id="label">${this.label}</span>
      <button
        id="play"
        @click=${this.#toggle}
        aria-label=${playing ? 'Pause' : paused ? 'Resume' : this.label}
      >${playIcon}</button>
      ${playing || paused ? html`
        <button
          id="stop"
          @click=${this.#handleStop}
          aria-label="Stop"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>
      ` : nothing}
      <div id="progress"
        role="progressbar"
        aria-valuenow=${current}
        aria-valuemin=${0}
        aria-valuemax=${total || 100}
        aria-label="Reading progress"
        aria-hidden=${total === 0 ? 'true' : 'false'}
      >
        <div id="track">
          <div id="fill" style=${styleMap({
            'inline-size': `${this.#progress * 100}%`,
          })}></div>
        </div>
      </div>
      <span id="status" aria-live="polite">${total > 0 ? `${current} of ${total}` : ''}</span>
      <button
        id="speed"
        @click=${this.#cycleRate}
        aria-label=${`Playback speed: ${rate}x`}
      >${rate}x</button>
      <button
        id="scroll"
        @click=${this.#toggleAutoScroll}
        aria-pressed=${autoScroll ? 'true' : 'false'}
        aria-label="Auto-scroll to current paragraph"
      >Scroll</button>
      <span id="announce" role="status" aria-live="polite">${this._announcement}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'flotsam-page-reader': FlotsamPageReader;
  }
}
