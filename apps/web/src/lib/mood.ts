import { sadness, type DjSong } from './dj-brain';

/**
 * The feeling of a song, read from its title, lyrics and genres, for the "By mood" visualizer: rain for a sad
 * song, rose petals for a love song, a sunrise for an uplifting one, fireworks for a party, fireflies for a calm one.
 * Null when the words do not say; the visualizer then goes by how energetic the sound is.
 */
export type Mood = 'sad' | 'romantic' | 'uplifting' | 'energetic' | 'calm';

const ROMANTIC = /\b(love|lovin|loving|lover|kiss|kisses|darling|forever|beautiful|hold you|hold me|together|you and me|romance|valentine|honey|sweetheart|my heart|your heart|my girl|my baby|in love|fall for|falling for|my love|cuddle|ring|marry|wedding)\b/g;
const ENERGETIC = /\b(party|dance|dancin|club|turn up|turnt|lit|jump|hype|bounce|wild|let's go|lets go|go hard|rage|mosh|shake it|move it|work it|tonight we|all night|celebrate|pop off|turn it up|loud)\b/g;
const UPLIFTING = /\b(sun|sunshine|shine|smile|smilin|happy|alive|free|freedom|fly|flying|rise|rising|dream|dreams|hope|light|good day|blessed|grateful|believe|higher|win|winning|glory|bright|golden|summer)\b/g;
const CALM = /\b(slow|quiet|calm|easy|breathe|ocean|waves|rain|night sky|moon|stars|sleep|drift|float|peace|still|gentle|lullaby)\b/g;

const GENRE_MOOD: [RegExp, Mood][] = [
  [/ambient|chill|lo-?fi|downtempo|new age|acoustic|classical|piano/i, 'calm'],
  [/edm|dance|house|techno|trance|drum|dubstep|party|electro|hyperpop|reggaeton/i, 'energetic'],
  [/gospel|funk|disco|happy|feel.?good|soul/i, 'uplifting'],
  [/romance|love|r&b|rnb|ballad/i, 'romantic']
];

function density(text: string, re: RegExp, words: number): number {
  return ((text.match(re) ?? []).length / words) * 40;
}

export function songMood(song: DjSong): Mood | null {
  const text = `${song.title} ${(song.lyrics ?? []).join(' ')}`.toLowerCase();
  const words = Math.max(1, text.split(/\s+/).length);
  const lyricsKnown = (song.lyrics?.length ?? 0) > 3;
  const scores: Record<Mood, number> = {
    sad: sadness(song),
    // "Baby" and "love" are everywhere in pop: love needs to be a real theme, not one line.
    romantic: lyricsKnown ? density(text, ROMANTIC, words) * 0.8 : (text.match(ROMANTIC) ?? []).length * 0.5,
    energetic: lyricsKnown ? density(text, ENERGETIC, words) : (text.match(ENERGETIC) ?? []).length * 0.5,
    uplifting: lyricsKnown ? density(text, UPLIFTING, words) * 0.8 : (text.match(UPLIFTING) ?? []).length * 0.5,
    calm: lyricsKnown ? density(text, CALM, words) : (text.match(CALM) ?? []).length * 0.5
  };
  for (const [re, mood] of GENRE_MOOD) if ((song.genres ?? []).some(g => re.test(g))) scores[mood] += 0.25;
  const [best, score] = (Object.entries(scores) as [Mood, number][]).sort((a, b) => b[1] - a[1])[0]!;
  // Sadness weighs heaviest: a sad love song is still a sad song.
  if (scores.sad >= 0.45) return 'sad';
  return score >= 0.4 ? best : null;
}

/** When the words say nothing: how hard the music hits (average level 0..1 over the last seconds). */
export function moodFromEnergy(level: number): Mood {
  return level > 0.42 ? 'energetic' : level > 0.3 ? 'uplifting' : 'calm';
}

export const MOOD_LABEL: Record<Mood, string> = { sad: 'Sad', romantic: 'Romantic', uplifting: 'Uplifting', energetic: 'Energetic', calm: 'Calm' };
