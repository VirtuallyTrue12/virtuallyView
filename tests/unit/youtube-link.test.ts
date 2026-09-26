import { describe, it, expect } from 'vitest';
import { youtubeIdFromText } from '../../apps/web/src/lib/youtube-link.js';

describe('recognising a pasted YouTube link', () => {
  it('finds the video in every common shape of link', () => {
    const id = '9PSo4PjbDbs';
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=120s`, `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}&list=RDAMVM${id}`, `https://youtu.be/${id}?si=abc`, `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}?feature=share`, `https://www.youtube.com/embed/${id}`,
      `  https://www.youtube.com/watch?v=${id}  `, `www.youtube.com/watch?v=${id}`
    ]) expect(youtubeIdFromText(link), link).toBe(id);
  });

  it('leaves searches, other sites and playlists alone', () => {
    for (const text of ['linkin park live concert', 'https://example.com/watch?v=9PSo4PjbDbs', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/@LinkinPark', 'https://www.youtube.com/watch?v=short', '', 'Metallica12', 'https://youtu.be/']) {
      expect(youtubeIdFromText(text), text).toBeNull();
    }
  });
});
