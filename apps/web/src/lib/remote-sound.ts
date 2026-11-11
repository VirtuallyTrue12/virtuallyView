/** A quiet tick when the TV remote moves focus. Generated with WebAudio (no audio files). */

const KEY = 'vv-remote-sounds';

/** On by default on a TV, off elsewhere; the Appearance setting overrides either. */
export function remoteSoundsOn(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on' || v === 'off') return v === 'on';
  } catch { /* none */ }
  return document.documentElement.classList.contains('tv');
}

export function setRemoteSounds(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* none */ }
}

let ctx: AudioContext | null = null;

/** A 20 ms blip at low volume. Silent while a video or song is playing. */
export function tick(): void {
  if (!remoteSoundsOn()) return;
  if ([...document.querySelectorAll<HTMLMediaElement>('video, audio')].some(m => !m.paused && !m.ended)) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.03, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.025);
  } catch { /* no audio on this device */ }
}
