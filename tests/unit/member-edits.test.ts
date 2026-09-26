import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-me-'));

const members = [
  { name: 'Mike Shinoda', role: 'guitar', years: '1996–present', current: true, photo: '' },
  { name: 'Chester Bennington', role: 'lead vocals', years: '1996–2017', current: false, photo: '' },
  { name: 'Mark Wakefield', role: 'lead vocals', years: '1996–1998', current: false, photo: '' }
];

describe('an administrator\'s corrections to a band', () => {
  it('marks people current or former, removes some and adds a missing one, on top of what MusicBrainz says', async () => {
    const { applyEdits, saveEdit, listEdits, clearEdit } = await import('../../apps/server/src/services/member-edits.js');
    saveEdit('lidarr-4', { name: 'chester bennington', action: 'set', current: true });
    saveEdit('lidarr-4', { name: 'Mark Wakefield', action: 'remove' });
    saveEdit('lidarr-4', { name: 'Emily Armstrong', action: 'add', role: 'lead vocals', years: '2024–present', current: true });
    const out = applyEdits(members, listEdits('lidarr-4'));
    expect(out.map(m => m.name)).toEqual(['Mike Shinoda', 'Chester Bennington', 'Emily Armstrong']);
    expect(out.find(m => m.name === 'Chester Bennington')).toMatchObject({ current: true, edited: true, role: 'lead vocals' });
    expect(out.find(m => m.name === 'Emily Armstrong')).toMatchObject({ role: 'lead vocals', edited: true });
    // Undoing an edit brings the original back.
    clearEdit('lidarr-4', 'Mark Wakefield');
    expect(applyEdits(members, listEdits('lidarr-4')).map(m => m.name)).toContain('Mark Wakefield');
  });

  it('keeps edits per artist', async () => {
    const { listEdits } = await import('../../apps/server/src/services/member-edits.js');
    expect(listEdits('lidarr-99')).toEqual([]);
  });
});
