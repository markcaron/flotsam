import { LitElement, html, isServer, nothing } from 'lit';
import { customElement } from 'lit/decorators/custom-element.js';
import { property } from 'lit/decorators/property.js';
import { state } from 'lit/decorators/state.js';
import { styleMap } from 'lit/directives/style-map.js';

import styles from './flotsam-speech-player.css' with { type: 'css' };

interface Segment {
  text: string;
  element: Element;
}

/**
 * A text-to-speech player that reads page content aloud using the
 * Web Speech Synthesis API. Point it at a content container via the
 * `target` attribute and it extracts readable text elements, synthesizes
 * speech one paragraph at a time, highlights the active element, and
 * optionally auto-scrolls to keep it in view.
 *
 * Consumers should provide a `.flotsam-speech-active` style rule in
 * their light-DOM stylesheet to visually indicate the active paragraph.
 *
 * @summary Text-to-speech reader for page content.
 *
 * @cssprop {<color>} --flotsam-color-interactive-default - Primary interactive
 *   color used for hover/pressed backgrounds and the progress fill.
 * @cssprop {<color>} --flotsam-color-interactive-text - Text color on
 *   interactive backgrounds.
 * @cssprop {<color>} --flotsam-color-surface-subtle - Track background color.
 * @cssprop {<color>} --flotsam-color-focus - Focus ring color.
 *
 * @fires {Event} flotsam-speech-player-end - Fires when speech playback
 *   completes naturally (not on stop).
 */
@customElement('flotsam-speech-player')
export class FlotsamSpeechPlayer extends LitElement {
  static readonly styles = [styles];

  /** CSS selector for the content element whose text will be read aloud. */
  @property() target?: string;

  /** Preferred voice name. Falls back to the default voice for the page language. */
  @property() voice?: string;

  @state() _playing = false;
  @state() _paused = false;
  @state() _rate = 1;
  @state() _autoScroll = true;
  @state() _currentIndex = -1;
  @state() _totalSegments = 0;

  #segments: Segment[] = [];
  #supported = true;

  get #progress(): number {
    if (this._totalSegments === 0 || this._currentIndex < 0) return 0;
    return (this._currentIndex + 1) / this._totalSegments;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!isServer) {
      this.#supported = 'speechSynthesis' in window;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (!isServer && this.#supported) {
      this.#stop();
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
      new Event('flotsam-speech-player-end', { bubbles: true, composed: true }),
    );
  }

  #toggle = (): void => {
    if (this._playing) {
      this.#pause();
    } else {
      this.#play();
    }
  };

  #handleStop = (): void => {
    this.#stop();
  };

  #cycleRate = (): void => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const idx = rates.indexOf(this._rate);
    this._rate = rates[(idx + 1) % rates.length];
  };

  #toggleAutoScroll = (): void => {
    this._autoScroll = !this._autoScroll;
  };

  #highlightCurrent(): void {
    this.#clearHighlight();
    const seg = this.#segments[this._currentIndex];
    if (!seg) return;
    seg.element.classList.add('flotsam-speech-active');
    seg.element.setAttribute('aria-current', 'true');
    if (this._autoScroll) {
      seg.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  #clearHighlight(): void {
    for (const seg of this.#segments) {
      seg.element.classList.remove('flotsam-speech-active');
      seg.element.removeAttribute('aria-current');
    }
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
      <button
        id="play"
        @click=${this.#toggle}
        aria-label=${playing ? 'Pause' : paused ? 'Resume' : 'Play'}
      >${playIcon}</button>
      ${playing || paused ? html`
        <button
          id="stop"
          @click=${this.#handleStop}
          aria-label="Stop"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>
      ` : nothing}
      <div id="progress">
        <div id="track">
          <div id="fill" style=${styleMap({
            'inline-size': `${this.#progress * 100}%`,
          })}></div>
        </div>
      </div>
      ${total > 0 ? html`
        <span id="status">${current} of ${total}</span>
      ` : nothing}
      <button
        id="speed"
        @click=${this.#cycleRate}
        aria-label=${`Playback speed: ${rate}x`}
      >${rate}x</button>
      <button
        id="scroll"
        @click=${this.#toggleAutoScroll}
        aria-pressed=${autoScroll ? 'true' : 'false'}
        aria-label="Auto-scroll"
        title="Auto-scroll to current paragraph"
      >Scroll</button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'flotsam-speech-player': FlotsamSpeechPlayer;
  }
}
