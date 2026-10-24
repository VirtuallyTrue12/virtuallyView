import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMusicPlayer } from '../media/MusicProvider';
import { useRadio } from '../radio/RadioProvider';

type Command = { label: string; group: string; keywords?: string; action: () => void };

const PAGES: [string, string, string?][] = [
  ['Home', '/'], ['Movies', '/movies', 'films'], ['TV shows', '/series', 'series episodes'], ['Music', '/music', 'songs artists albums'],
  ['Radio', '/radio', 'stations'], ['Live TV', '/live', 'channels'], ['Videos', '/videos', 'youtube'], ['Photos', '/photos'],
  ['Books', '/books', 'audiobooks comics'], ['Offline wiki', '/wiki', 'wikipedia'], ['Requests', '/requests', 'add new'],
  ['Downloads', '/downloads', 'torrents queue'], ['Activity', '/activity', 'history'], ['Statistics', '/statistics'],
  ['Apps', '/apps', 'home lab'], ['Themes', '/themes', 'appearance look'], ['Settings', '/settings', 'preferences'],
  ['Account', '/account', 'profile password'], ['Diagnostics', '/diagnostics', 'health doctor logs']
];

/** Ctrl+K / ⌘K: jump to any page, control what is playing, or search the library. */
export default function CommandPalette() {
  const navigate = useNavigate();
  const music = useMusicPlayer();
  const radio = useRadio();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (music.queue.length) {
      list.push({ group: 'Playing', label: music.playing ? 'Pause music' : 'Resume music', keywords: 'play pause', action: music.toggle });
      list.push({ group: 'Playing', label: 'Next track', keywords: 'skip', action: music.nextTrack });
      list.push({ group: 'Playing', label: 'Previous track', keywords: 'back', action: music.prevTrack });
      list.push({ group: 'Playing', label: music.djMode ? 'Turn DJ mode off' : 'Turn DJ mode on', keywords: 'voice narration', action: () => music.setDjMode(!music.djMode) });
    }
    if (radio.station) list.push({ group: 'Playing', label: `Stop radio (${radio.station.name})`, action: radio.stop });
    for (const [label, path, keywords] of PAGES) list.push({ group: 'Go to', label, keywords, action: () => navigate(path) });
    list.push({ group: 'Actions', label: 'Request a movie or show', keywords: 'add download', action: () => navigate('/requests') });
    list.push({ group: 'Actions', label: 'Ask the AI assistant', keywords: 'chat help', action: () => window.dispatchEvent(new Event('open-chat')) });
    list.push({ group: 'Actions', label: 'Reload', keywords: 'refresh', action: () => window.location.reload() });
    return list;
  }, [music, radio, navigate]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const hits = q ? commands.filter(c => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q)) : commands;
    return q ? [...hits, { group: 'Search', label: `Search the library for “${query.trim()}”`, action: () => navigate(`/search?q=${encodeURIComponent(query.trim())}`) }] : hits;
  }, [commands, q, query, navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const run = useCallback((cmd: Command | undefined) => { if (!cmd) return; setOpen(false); cmd.action(); }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') run(filtered[selected]);
  }, [filtered, selected, run]);

  useEffect(() => { document.querySelector('.command-palette-row.is-selected')?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette-head">
          <span className="command-palette-label">Go anywhere</span>
          <kbd className="command-palette-shortcut">Esc</kbd>
        </div>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          placeholder="Type a page, a command or a title…"
          aria-label="Search commands"
        />
        <div className="command-palette-list" role="listbox">
          {filtered.map((cmd, i) => (
            <button
              key={`${cmd.group}-${cmd.label}`}
              className={`command-palette-row${i === selected ? ' is-selected' : ''}`}
              type="button"
              role="option"
              onMouseMove={() => setSelected(i)}
              onClick={() => run(cmd)}
              aria-selected={i === selected}
            >
              <span className="command-palette-icon" aria-hidden="true">{cmd.group}</span>
              <span className="command-palette-label">{cmd.label}</span>
            </button>
          ))}
        </div>
        <p className="command-palette-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>/</kbd> or <kbd>Ctrl K</kbd> anywhere</p>
      </div>
    </div>
  );
}
