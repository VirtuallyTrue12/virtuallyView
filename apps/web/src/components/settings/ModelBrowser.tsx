import { useEffect, useState } from 'react';
import { api, type ModelCatalogResponse } from '../../lib/api';

const FIT_LABEL: Record<string, string> = {
  fits: 'Fits comfortably',
  tight: 'Tight fit',
  'too-big': 'Likely too big for this system'
};

/**
 * Search a curated table of known Ollama models (Ollama itself has no
 * "browse the library" API) and show each one's approximate resource needs
 * against what this machine actually has, so a search for "qwen" turns into
 * "which of these will actually run here" instead of a guess.
 */
export default function ModelBrowser({
  installedTags, activeModel, pulling, pullPercent, onPull
}: {
  installedTags: Set<string>;
  activeModel?: string | null;
  pulling: string | null;
  pullPercent: number | null;
  onPull: (tag: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ModelCatalogResponse | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.aiModelCatalog(query).then(setData).catch(() => setData(null));
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="settings-section">
      <h3 className="section-title">Browse models</h3>
      <p className="model-suggest-meta">
        {data ? `This machine has ${data.system.totalMemGB} GB RAM (${data.system.freeMemGB} GB free right now, ${data.system.cpuCount} CPU cores).` : 'Checking this machine\'s resources...'}
        {' '}Sizes are approximate (Q4 quantization) - actual use varies with context length.
      </p>
      <input
        className="settings-input"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search models, e.g. qwen, llama, coder"
        aria-label="Search models"
      />
      <div className="model-suggest-grid">
        {data?.models.map(m => {
          const installed = installedTags.has(m.tag);
          const isPulling = pulling === m.tag;
          return (
            <div className={`model-suggest-card${installed ? ' model-suggest-card--installed' : ''} model-suggest-card--${m.fit}`} key={m.tag}>
              <div className="model-suggest-head">
                <span className="model-suggest-title">{m.title} {m.params}</span>
                <span className="model-suggest-tag">{m.tag}</span>
              </div>
              <p className="model-suggest-meta">{m.diskGB} GB disk · ~{m.ramGB} GB RAM · {m.use}</p>
              <span className={`model-fit model-fit--${m.fit}`}>{FIT_LABEL[m.fit]}</span>
              <div className="model-suggest-actions">
                {installed ? (
                  <span className="model-suggest-installed">
                    {activeModel === m.tag && <span className="model-active">active</span>}
                    Installed
                  </span>
                ) : (
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => onPull(m.tag)} disabled={!!pulling}>
                    {isPulling ? (pullPercent != null ? `Pulling ${pullPercent}%...` : 'Pulling...') : 'Pull'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {data && data.models.length === 0 && <div className="empty-state"><span>No known models match "{query}". Pull a custom tag below if you know the exact name.</span></div>}
      </div>
    </div>
  );
}
