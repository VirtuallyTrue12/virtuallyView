import { useState } from 'react';
import { lookupRequestCandidates } from '../../lib/request-selection';
import { useRequester } from '../../lib/useRequester';
import { QualitySelect } from '../requests/QualitySelect';

/** Search for an artist by name and add them to the Music library. */
export function AddArtist({ onAdded }: { onAdded?: () => void }) {
  const [name, setName] = useState('');
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const requester = useRequester(outcome => {
    setNote({ tone: outcome.kind === 'ok' ? 'ok' : 'err', text: outcome.message });
    if (outcome.kind === 'ok') { setName(''); onAdded?.(); }
  });

  const find = async () => {
    const term = name.trim();
    if (!term || looking) return;
    setLooking(true);
    setNote(null);
    try {
      const { candidates } = await lookupRequestCandidates(term, 'artist');
      if (candidates.length === 0) setNote({ tone: 'err', text: `No artist found for "${term}".` });
      else requester.openPicker({ title: term, mediaType: 'artist' }, candidates, `Pick the artist to add to your Music library.`);
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setLooking(false);
    }
  };

  return (
    <section className="playlists-section" aria-label="Add an artist">
      <div className="playlists-head"><h2 className="section-title">Add an artist</h2></div>
      <div className="playlist-create-row">
        <input
          className="settings-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void find(); }}
          placeholder="Artist or band name"
          aria-label="Artist name"
          maxLength={120}
        />
        <QualitySelect mediaType="artist" compact />
        <button type="button" className="btn btn-primary" onClick={() => void find()} disabled={looking || !name.trim()}>
          {looking ? 'Searching…' : 'Find artist'}
        </button>
      </div>
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
      {requester.picker}
    </section>
  );
}
