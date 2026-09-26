import { describe, expect, it } from 'vitest';
import { judgeDownloaderNetwork } from '../../apps/server/src/services/troubleshoot.js';

describe('downloader network check', () => {
  it('is fine when connected', () => {
    expect(judgeDownloaderNetwork({ status: 'connected', dhtNodes: 300 }).status).toBe('ok');
  });

  it('does not raise an alarm for "firewalled" behind a VPN while peers are visible', () => {
    const v = judgeDownloaderNetwork({ status: 'firewalled', dhtNodes: 350 });
    expect(v.status).toBe('ok');
    expect(v.detail).toMatch(/downloading normally/);
    expect(v.detail).toMatch(/expected behind a VPN/);
  });

  it('warns when it is firewalled and cannot see any peers, and fails when there is no network', () => {
    expect(judgeDownloaderNetwork({ status: 'firewalled', dhtNodes: 0 }).status).toBe('warn');
    expect(judgeDownloaderNetwork({ status: 'disconnected', dhtNodes: 0 }).status).toBe('fail');
  });
});
