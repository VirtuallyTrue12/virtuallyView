/**
 * What the DJ says, and when. A real host does not talk between every song: most changes are a clean blend, and
 * every few songs there is one short break that looks back over the last few and leads into the next. Moments that
 * mean something get priority: a run of sad songs (a quieter, kinder word), a long stretch of one genre, the top
 * of the hour, a change after several songs by one artist. Pure so it can be tested; the player decides where in
 * the music the line fits (over an intro, never over singing).
 */

export type DjFrequency = 'minimal' | 'balanced' | 'chatty';
export type DjSong = { title: string; artist?: string; album?: string; genres?: string[]; lyrics?: string[] };
export type DjBreak = { text: string; soft: boolean; reason: 'recap' | 'mood' | 'genre' | 'hour' | 'artist' };

// How many songs between breaks (inclusive range) and the longest silence in minutes.
const PACE: Record<DjFrequency, { min: number; max: number; minutes: number }> = {
  minimal: { min: 4, max: 6, minutes: 20 },
  balanced: { min: 2, max: 4, minutes: 12 },
  chatty: { min: 1, max: 2, minutes: 6 }
};
/** The host stays quiet for the first few songs of a session. */
export const QUIET_START = 3;

const SAD = /\b(cry|cryin|crying|cried|tears|alone|lonely|sad|sadness|die|dyin|dying|death|dead|gone|goodbye|broken|break|pain|hurt|hurts|empty|lost|numb|depress\w*|suicid\w*|heartbreak|heartbroken|bleed|bleeding|grave|sorrow|hopeless|drown\w*|demons|anxiety|scared|lonely|miss you|missing you|let me go|without you|over dose|overdose|pills|funeral|rip)\b/g;
const SAD_GENRES = /sad|emo|blues|ballad|melanchol|grief|slowcore|dark/i;

/** How sad a song reads, from its title, lyrics and genres: 0 (not at all) to 1. */
export function sadness(song: DjSong): number {
  const text = `${song.title} ${(song.lyrics ?? []).join(' ')}`.toLowerCase();
  const words = Math.max(1, text.split(/\s+/).length);
  const hits = (text.match(SAD) ?? []).length;
  const genre = (song.genres ?? []).some(g => SAD_GENRES.test(g)) ? 0.35 : 0;
  // Lyrics: about one sad word in 40 is a heavy song. Title only: one hit is a strong hint.
  const fromWords = song.lyrics?.length ? Math.min(1, (hits / words) * 40) : Math.min(1, hits * 0.6);
  return Math.min(1, fromWords + genre);
}

const pick = <T,>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)]!;
const join = (items: string[]) => (items.length < 2 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const by = (s: DjSong) => (s.artist ? `${s.title} by ${s.artist}` : s.title);
const clock = (d: Date) => {
  const h = d.getHours() % 12 || 12, m = d.getMinutes();
  const part = d.getHours() < 5 ? 'in the middle of the night' : d.getHours() < 12 ? 'in the morning' : d.getHours() < 17 ? 'in the afternoon' : d.getHours() < 21 ? 'in the evening' : 'at night';
  return `${m === 0 ? `${h} o'clock` : m === 15 ? `quarter past ${h}` : m === 30 ? `half past ${h}` : `${h} ${m < 10 ? `oh ${m}` : m}`} ${part}`;
};

export class DjBrain {
  private played: DjSong[] = [];
  private sinceTalk = 0;
  private lastTalkAt: number;
  private target: number;
  private lastMoodAt = -99;
  private lastGenreAt = -99;
  private recent: string[] = [];
  /** Set by "Hear the DJ now": the next change gets a break whatever the pace. */
  force = false;

  constructor(public frequency: DjFrequency = 'balanced', private random: () => number = Math.random, now = Date.now()) {
    this.lastTalkAt = now;
    this.target = this.draw();
  }

  private draw(): number {
    const { min, max } = PACE[this.frequency];
    return min + Math.floor(this.random() * (max - min + 1));
  }

  /** A song finished and the next began by itself. */
  noteSong(song: DjSong): void {
    this.played.push(song);
    if (this.played.length > 50) this.played.shift();
    this.sinceTalk++;
  }

  /** A break was actually spoken. */
  commit(b: DjBreak, now = Date.now()): void {
    this.sinceTalk = 0;
    this.force = false;
    this.lastTalkAt = now;
    this.target = this.draw();
    if (b.reason === 'mood') this.lastMoodAt = this.played.length;
    if (b.reason === 'genre') this.lastGenreAt = this.played.length;
  }

  /** Templates not used lately, so the host never repeats the same sentence back to back. */
  private fresh(list: string[]): string {
    const options = list.filter(t => !this.recent.includes(t));
    const t = pick(options.length ? options : list, this.random);
    this.recent = [...this.recent.slice(-7), t];
    return t;
  }

  /**
   * What to say before `next`, or null for a plain blend. `upcoming` are the songs after it; `current` is the song
   * still playing, counted as heard (the break comes after it).
   */
  plan(next: DjSong, upcoming: DjSong[] = [], now = new Date(), current?: DjSong): DjBreak | null {
    if (!current) return this.decide(next, upcoming, now);
    this.played.push(current); this.sinceTalk++;
    try { return this.decide(next, upcoming, now); } finally { this.played.pop(); this.sinceTalk--; }
  }

  private decide(next: DjSong, upcoming: DjSong[], now: Date): DjBreak | null {
    const n = this.played.length;
    if (n < QUIET_START && !this.force) return null;
    const pace = PACE[this.frequency];
    const minutes = (now.getTime() - this.lastTalkAt) / 60000;
    const minGap = this.frequency === 'chatty' ? 1 : 2;
    if (this.sinceTalk < minGap && !this.force) return null;
    const last = this.played.slice(-4);
    // Lines carry {intro}, filled in only for the line that is used.
    const fill = (line: string) => line.replace('{intro}', () => this.intro(next));

    // A run of sad songs: a quieter word, now and then.
    const sadRun = this.played.slice(-3).filter(s => sadness(s) >= 0.45).length >= 2;
    if (sadRun && n - this.lastMoodAt >= 6 && this.random() < 0.7) {
      return { soft: true, reason: 'mood', text: fill(this.fresh([
        `If tonight's a heavy one, that's alright. Breathe out. {intro}`,
        `Some songs just sit with you, don't they. I'm still here. {intro}`,
        `Rough day? Put the phone down. Drink some water. The city will still be there. {intro}`,
        `Whoever you're missing, I hope they're missing you too. {intro}`,
        `Late hour, heavy heart. I know the feeling. {intro}`,
        `You don't have to be okay all the time. Stay with me. {intro}`
      ])) };
    }

    // A long stretch of one genre.
    const genre = (last[0]?.genres ?? []).find(g => last.length >= 4 && last.every(s => (s.genres ?? []).some(x => x.toLowerCase() === g.toLowerCase())));
    if (genre && n - this.lastGenreAt >= 8 && this.random() < 0.6) {
      const g = genre.toLowerCase();
      return { soft: false, reason: 'genre', text: fill(this.fresh([
        `Four straight ${g} tracks. Nobody's complaining. {intro}`,
        `We've been deep in ${g} for a while now. Good place to be. {intro}`,
        `If you came for ${g}, you came to the right place. {intro}`
      ])) };
    }

    // The top of the hour.
    if (now.getMinutes() < 4 && minutes >= 20) {
      return { soft: false, reason: 'hour', text: fill(`It's ${clock(now)}, and you're with virtually View. {intro}`) };
    }

    // Several songs by one artist, then a change.
    const run = this.played.slice(-3);
    if (run.length === 3 && run.every(s => s.artist && s.artist === run[0]!.artist) && next.artist && next.artist !== run[0]!.artist) {
      return { soft: false, reason: 'artist', text: fill(this.fresh([
        `Three in a row from ${run[0]!.artist}. Let's switch it up. {intro}`,
        `That was a little ${run[0]!.artist} run for you. Now, something different. {intro}`
      ])) };
    }

    if (this.sinceTalk < this.target && minutes < pace.minutes && !this.force) return null;

    // The usual break: look back over the last few, then lead into the next, with an extra now and then.
    const back = this.played.slice(-Math.max(1, Math.min(2, this.sinceTalk))).reverse();
    const titles = back.map(s => s.title);
    const sameArtist = back.length > 1 && back.every(s => s.artist && s.artist === back[0]!.artist);
    const recap = back.length === 1
      ? this.fresh([`That was ${by(back[0]!)}.`, `${by(back[0]!)}. Still hits.`, `You just heard ${by(back[0]!)}.`])
      : this.fresh([
        `That was ${titles[0]}, and before that ${join(titles.slice(1))}${sameArtist ? `, all ${back[0]!.artist}` : ''}.`,
        `${join(titles)}. That's the run${sameArtist ? ` from ${back[0]!.artist}` : ''}.`,
        `You've been listening to ${join(titles)}${sameArtist ? ` by ${back[0]!.artist}` : ''}.`
      ]);
    const extras: string[] = [];
    const roll = back.length > 1 ? this.random() * 1.6 : this.random();
    if (roll < 0.22 && upcoming.length >= 1) extras.push(upcoming.length >= 2 ? `Later on, ${upcoming[0]!.title} and ${upcoming[1]!.title}.` : `Coming up after this, ${upcoming[0]!.title}.`);
    else if (roll < 0.44 && next.album && next.album !== next.title) extras.push(`From the album ${next.album}.`);
    else if (roll < 0.56) extras.push(`It's ${clock(now)}.`);
    else if (roll < 0.66) extras.push(this.fresh([
      `Your neighbours asked us to turn it down. We said no.`,
      `No ads, no news, no traffic. Just music.`,
      `Stay hydrated out there.`,
      `Windows down if you can.`
    ]));
    return { soft: false, reason: 'recap', text: [recap, ...extras, this.intro(next)].join(' ') };
  }

  private intro(next: DjSong): string {
    // The same artist as the last song: the title is enough.
    const name = next.artist && next.artist === this.played[this.played.length - 1]?.artist ? next.title : by(next);
    return this.fresh([`Here's ${name}.`, `Up next, ${name}.`, `This is ${name}.`, `Next one: ${name}.`, `Keeping it going with ${name}.`]);
  }
}
