import { useState, useEffect, useRef, useCallback } from 'react';

const COMMANDS = [
  { label: 'Search media', shortcut: '', action: () => window.location.href = '/search', icon: 'Search' },
  { label: 'Open Movies', shortcut: '', action: () => window.location.href = '/movies', icon: 'Movies' },
  { label: 'Open TV Shows', shortcut: '', action: () => window.location.href = '/series', icon: 'TV' },
  { label: 'Open Music', shortcut: '', action: () => window.location.href = '/music', icon: 'Music' },
  { label: 'Open Downloads', shortcut: '', action: () => window.location.href = '/downloads', icon: 'Downloads' },
  { label: 'Open Requests', shortcut: '', action: () => window.location.href = '/requests', icon: 'Requests' },
  { label: 'Open Settings', shortcut: '', action: () => window.location.href = '/settings', icon: 'Settings' },
  { label: 'Refresh library', shortcut: '', action: () => window.location.reload(), icon: 'Refresh' },
  { label: 'Ask AI assistant', shortcut: '', action: () => { /* opens chat widget if open state is exposed; for now navigate to AI or open chat */ const event = new Event('open-chat'); window.dispatchEvent(event); }, icon: 'AI' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = COMMANDS.filter(cmd => cmd.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      const cmd = filtered[selected];
      if (cmd) {
        cmd.action();
        setOpen(false);
      }
    }
  }, [filtered, selected]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette-head">
          <span className="command-palette-label">Commands</span>
          <kbd className="command-palette-shortcut">Esc</kbd>
        </div>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          placeholder="Search commands..."
          aria-label="Search commands"
        />
        <div className="command-palette-list">
          {filtered.length === 0 && <div className="empty-state">No commands match.</div>}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.label}
              className={`command-palette-row${i === selected ? ' is-selected' : ''}`}
              type="button"
              onClick={() => { cmd.action(); setOpen(false); }}
              aria-selected={i === selected}
            >
              <span className="command-palette-icon" aria-hidden="true">{cmd.icon}</span>
              <span className="command-palette-label">{cmd.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
