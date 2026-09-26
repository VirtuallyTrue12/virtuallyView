import { describe, expect, it } from 'vitest';
import { describeSettingsChange } from '../../apps/server/src/services/settings-history.js';
import type { ServerSettings } from '../../apps/server/src/services/server-settings.js';

const base = (): ServerSettings => ({
  serverName: 'virtuallyView', mediaRoots: { movies: '/m', tv: '/t', music: '/mu', staging: '/s' }, logLevel: 'info', bindAddress: '0.0.0.0', port: 3000,
  folderChangeRequiresConfirmation: true, coverSource: 'tmdb', outboundProxy: { enabled: false, kind: 'tor', host: '', port: 9050 }, onboardingComplete: true,
  allowSignup: false, trustLocalNetwork: false, publicUrl: '', defaultQuality: { movie: '', series: '', artist: '' },
  requests: { approval: 'off', limit: 0, window: 'week' }, notifications: { channels: [] }, autoBackup: true
});

describe('settings history', () => {
  it('says nothing when nothing changed', () => {
    expect(describeSettingsChange(base(), base())).toEqual([]);
  });

  it('describes each change in words, without the values of secrets', () => {
    const after = base();
    after.serverName = 'Home';
    after.mediaRoots.tv = '/other';
    after.autoBackup = false;
    after.publicUrl = 'http://192.168.1.20:3000';
    after.notifications = { channels: [{ id: 'c', kind: 'discord', name: 'Family', enabled: true, config: { url: 'https://discord.example/secret-token' } } as never] };
    const changes = describeSettingsChange(base(), after);
    expect(changes.map(c => c.area).sort()).toEqual(['Backup', 'Folders', 'General', 'Network', 'Notifications']);
    const text = changes.map(c => c.summary).join(' | ');
    expect(text).toContain('Automatic backups turned off');
    expect(text).toContain('The TV folder was changed');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('192.168.1.20');
  });
});
