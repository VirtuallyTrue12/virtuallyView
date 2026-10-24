/**
 * The music player's sound path, shared by the equalizer, the visualizers and DJ mode.
 *
 *   deck A ─ gain ─┐
 *                  ├─ preamp ─ 10 EQ bands ─ balance ─ leveller ─ analyser ─ speakers
 *   deck B ─ gain ─┘
 *
 * Two decks so one track can fade into the next. The graph is built once, on the first play (a browser only lets
 * an AudioContext make sound after the person has interacted with the page). With the equalizer off every band
 * sits at 0 dB and the preamp at unity, which leaves the sound untouched.
 */

export const EQ_BANDS = [
  { label: '32', freq: 32, type: 'lowshelf' },
  { label: '64', freq: 64, type: 'peaking' },
  { label: '125', freq: 125, type: 'peaking' },
  { label: '250', freq: 250, type: 'peaking' },
  { label: '500', freq: 500, type: 'peaking' },
  { label: '1k', freq: 1000, type: 'peaking' },
  { label: '2k', freq: 2000, type: 'peaking' },
  { label: '4k', freq: 4000, type: 'peaking' },
  { label: '8k', freq: 8000, type: 'peaking' },
  { label: '16k', freq: 16000, type: 'highshelf' }
] as const;

export type EqPreset = { name: string; gains: number[] };
export const EQ_PRESETS: Record<string, EqPreset> = {
  flat: { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: 'Bass boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  treble: { name: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  loudness: { name: 'Loudness', gains: [6, 5, 3, 0, -1, -1, 0, 2, 4, 5] },
  rock: { name: 'Rock', gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  pop: { name: 'Pop', gains: [-1, 0, 2, 3, 4, 3, 2, 0, -1, -1] },
  dance: { name: 'Dance', gains: [6, 5, 3, 0, 0, -2, -1, 2, 4, 4] },
  hiphop: { name: 'Hip-hop', gains: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3] },
  electronic: { name: 'Electronic', gains: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5] },
  jazz: { name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  classical: { name: 'Classical', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  acoustic: { name: 'Acoustic', gains: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1] },
  vocal: { name: 'Vocal', gains: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
  spoken: { name: 'Podcast / spoken', gains: [-4, -3, -1, 1, 3, 4, 4, 2, 0, -2] },
  latenight: { name: 'Late night', gains: [2, 2, 1, 0, 0, 0, 0, -1, -2, -3] },
  smallspeakers: { name: 'Small speakers', gains: [6, 5, 4, 2, 0, 0, 1, 2, 2, 1] },
  headphones: { name: 'Headphones', gains: [3, 2, 1, 0, 0, -1, 0, 1, 2, 2] }
};

export interface EqState { enabled: boolean; gains: number[]; preamp: number; balance: number; leveller: boolean }

type Deck = { el: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode };

class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private decks = new Map<HTMLAudioElement, Deck>();
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private panner: StereoPannerNode | null = null;
  private leveller: DynamicsCompressorNode | null = null;
  private state: EqState = { enabled: false, gains: EQ_PRESETS.flat!.gains, preamp: 0, balance: 0, leveller: false };
  private failed = false;
  private voiceBus: GainNode | null = null;

  /** A context for the voice even when no music has played yet (radio announcements). */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.failed) return null;
    try { this.attach([]); } catch { /* no Web Audio */ }
    return this.ctx;
  }

  /**
   * Plays a spoken line over the music, on its own path so the equalizer never colours it. Resolves when the line
   * ends. Returns false when the line could not be played this way.
   */
  async playVoice(data: ArrayBuffer, onStart?: (seconds: number) => void): Promise<boolean> {
    const ctx = this.context();
    if (!ctx) return false;
    try {
      await this.resume();
      const buffer = await ctx.decodeAudioData(data);
      if (!this.voiceBus) { this.voiceBus = ctx.createGain(); this.voiceBus.gain.value = 1.15; this.voiceBus.connect(ctx.destination); }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.voiceBus);
      onStart?.(buffer.duration);
      await new Promise<void>(resolve => { src.onended = () => resolve(); src.start(); });
      return true;
    } catch { return false; }
  }

  /** Builds the graph (once) and connects these elements. Returns false when Web Audio is not available. */
  attach(elements: HTMLAudioElement[]): boolean {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        const preamp = ctx.createGain();
        const filters = EQ_BANDS.map(b => {
          const f = ctx.createBiquadFilter();
          f.type = b.type as BiquadFilterType;
          f.frequency.value = b.freq;
          f.Q.value = b.type === 'peaking' ? 1.1 : 0.7;
          return f;
        });
        const panner = ctx.createStereoPanner();
        const leveller = ctx.createDynamicsCompressor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        // Music sits between about -90 and -15 dBFS: the default -30 ceiling pinned every bar at the top.
        analyser.minDecibels = -90;
        analyser.maxDecibels = -12;
        preamp.connect(filters[0]!);
        for (let i = 1; i < filters.length; i++) filters[i - 1]!.connect(filters[i]!);
        filters[filters.length - 1]!.connect(panner);
        panner.connect(leveller);
        leveller.connect(analyser);
        analyser.connect(ctx.destination);
        Object.assign(this, { ctx, preamp, filters, panner, leveller, analyser });
        this.apply();
      }
      for (const el of elements) {
        if (this.decks.has(el)) continue;
        const source = this.ctx!.createMediaElementSource(el);
        const gain = this.ctx!.createGain();
        source.connect(gain);
        gain.connect(this.preamp!);
        this.decks.set(el, { el, source, gain });
      }
      void this.resume();
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  get ready(): boolean { return !!this.ctx; }

  resume(): Promise<void> {
    return this.ctx && this.ctx.state === 'suspended' ? this.ctx.resume().catch(() => undefined) : Promise.resolve();
  }

  setEq(next: Partial<EqState>): void {
    this.state = { ...this.state, ...next };
    this.apply();
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const on = this.state.enabled;
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? (this.state.gains[i] ?? 0) : 0, now, 0.03));
    // Headroom: boosting bands would push loud passages past full scale and crackle, so the level comes down by
    // most of the biggest boost (what desktop players call auto pre-amp).
    const headroom = on ? Math.max(0, ...this.state.gains) * 0.8 : 0;
    this.preamp!.gain.setTargetAtTime(on ? Math.pow(10, (this.state.preamp - headroom) / 20) : 1, now, 0.03);
    this.panner!.pan.setTargetAtTime(on ? this.state.balance : 0, now, 0.03);
    // The leveller evens out loud and quiet tracks. Off = a compressor at ratio 1, which changes nothing.
    const lev = on && this.state.leveller;
    this.leveller!.threshold.value = lev ? -24 : 0;
    this.leveller!.knee.value = lev ? 18 : 0;
    this.leveller!.ratio.value = lev ? 4 : 1;
    this.leveller!.attack.value = 0.01;
    this.leveller!.release.value = 0.25;
  }

  /** The EQ curve's response at these frequencies, in dB, for drawing. */
  response(freqs: Float32Array<ArrayBuffer>): Float32Array {
    const total = new Float32Array(freqs.length);
    const mag = new Float32Array(freqs.length);
    const phase = new Float32Array(freqs.length);
    for (const f of this.filters) {
      f.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i] || 1e-6);
    }
    return total;
  }

  /** Fades one deck to a level over `seconds` (0..1). Falls back to element volume without Web Audio. */
  fade(el: HTMLAudioElement, to: number, seconds: number): void {
    const deck = this.decks.get(el);
    if (!deck || !this.ctx) return;
    const now = this.ctx.currentTime;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(deck.gain.gain.value, now);
    deck.gain.gain.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
  }

  level(el: HTMLAudioElement, value: number): void {
    const deck = this.decks.get(el);
    if (!deck || !this.ctx) return;
    deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    deck.gain.gain.setValueAtTime(value, this.ctx.currentTime);
  }
}

export const audioEngine = new AudioEngine();

/** The voice chosen in Mix & DJ: a server voice id (Piper) or a browser voice name. */
const voiceCache = new Map<string, Promise<ArrayBuffer | null>>();

/** Fetches (and keeps) the spoken line, so it can be ready before the moment it is needed. */
export function prepareLine(text: string, voice?: string): Promise<ArrayBuffer | null> {
  const key = `${voice ?? ''}|${text}`;
  let hit = voiceCache.get(key);
  if (!hit) {
    const params = new URLSearchParams({ text, ...(voice && !voice.startsWith('browser:') ? { voice } : {}) });
    hit = fetch(`/api/tts?${params}`, { credentials: 'same-origin' }).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    voiceCache.set(key, hit);
    if (voiceCache.size > 30) voiceCache.delete(voiceCache.keys().next().value!);
  }
  return hit;
}

/**
 * Says a line: the natural server voice when it is installed, otherwise the browser's own voice, otherwise
 * nothing (and quickly, so the music never waits on a voice that will not come).
 */
export async function say(text: string, voice?: string, onStart?: (seconds: number) => void): Promise<void> {
  if (!voice?.startsWith('browser:')) {
    const data = await prepareLine(text, voice);
    // decodeAudioData detaches the buffer it is given: hand it a copy so a cached line can be said again.
    if (data && await audioEngine.playVoice(data.slice(0), onStart)) return;
  }
  const hasVoices = typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.getVoices().length > 0;
  if (!hasVoices) return;
  onStart?.(Math.max(2, text.split(' ').length / 2.6));
  await speak(text, voice?.replace(/^browser:/, ''));
}

/** Speaks a line with the browser's own voices. Resolves when done (or at once when speech is not available). */
export function speak(text: string, voiceName?: string, rate = 1.02): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { resolve(); return; }
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.name === voiceName) ?? voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /natural|neural|google|samantha|daniel/i.test(v.name)) ?? voices.find(v => /^en/i.test(v.lang));
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = 1;
      const done = () => { clearTimeout(guard); resolve(); };
      // Some engines never fire "end": never let a narration hold up the music.
      const guard = setTimeout(done, 12000);
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** What the DJ says between two tracks. Varied so it does not sound like a loop. */
export function djLine(prev: { title: string; artist?: string } | null, next: { title: string; artist?: string }): string {
  const by = (t: { title: string; artist?: string }) => (t.artist ? `${t.title} by ${t.artist}` : t.title);
  const hour = new Date().getHours();
  const timeOfDay = hour < 5 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  const intros = [
    `Up next, ${by(next)}.`,
    `Here's ${by(next)}.`,
    `Keeping it going with ${by(next)}.`,
    `Coming up for your ${timeOfDay}: ${by(next)}.`,
    `Let's switch it up. This is ${by(next)}.`,
    `You're listening to virtually View. Next, ${by(next)}.`
  ];
  if (!prev || Math.random() < 0.35) return pick(intros);
  const outros = [`That was ${by(prev)}.`, `${by(prev)}, nice.`, `You just heard ${by(prev)}.`];
  return `${pick(outros)} ${pick(intros)}`;
}

export function radioLine(name: string, extra?: string): string {
  const intros = [`Tuning in to ${name}.`, `Now playing: ${name}.`, `Switching over to ${name}.`, `You're now listening to ${name}.`];
  return `${pick(intros)}${extra ? ` ${extra}.` : ''}`;
}
