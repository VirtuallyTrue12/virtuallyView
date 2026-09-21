import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getServerSettings } from './server-settings.js';

const execFileAsync = promisify(execFile);

export interface OutboundProxyConfig {
  enabled: boolean;
  kind: 'tor' | 'socks5' | 'http';
  host: string;
  port: number;
}

function activeProxy(): OutboundProxyConfig | null {
  try {
    const fromSettings = getServerSettings().outboundProxy;
    if (fromSettings?.enabled && fromSettings.host && fromSettings.port > 0) return fromSettings;
  } catch {
    // Settings unreadable: fall back to the environment override below
  }
  const raw = process.env.OUTBOUND_PROXY;
  if (raw && raw.includes('://')) {
    const [scheme, rest] = raw.split('://');
    const [host, portRaw] = rest.split(':');
    const port = Number(portRaw);
    if (host && Number.isInteger(port) && port > 0) {
      const kind = scheme === 'http' || scheme === 'https' ? 'http' : 'tor';
      return { enabled: true, kind, host, port };
    }
  }
  return null;
}

function proxyUrl(proxy: OutboundProxyConfig): string {
  // socks5h resolves DNS through the tunnel so nothing leaks to the local
  // resolver; http proxies are passed through verbatim for HTTP clients.
  if (proxy.kind === 'http') return `http://${proxy.host}:${proxy.port}`;
  return `socks5h://${proxy.host}:${proxy.port}`;
}

const HTTP_STATUS_RE = /^HTTP\/\S+\s+(\d{3})/m;

/**
 * Outbound fetch for PUBLIC internet calls (Wikipedia, MusicBrainz, web covers).
 *
 * When Settings > Outbound proxy is enabled, requests are tunneled through it
 * via curl, which supports both HTTP and SOCKS5 proxies with DNS inside the
 * tunnel and needs no native addon. Local *arr services are NOT routed through
 * this helper - they stay on plain fetch so a proxy outage can never take down
 * the dashboard. The caller sees a normal Response-like object, or an Error
 * when the proxy itself is unreachable (no silent fallback).
 */
export async function outboundFetch(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string; timeoutMs?: number } = {}
): Promise<Response> {
  const proxy = activeProxy();

  if (!proxy) {
    return fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000)
    });
  }

  const seconds = Math.max(2, Math.ceil((init.timeoutMs ?? 8000) / 1000));
  const headerFile = join(mkdtempSync(join(tmpdir(), 'vv-curl-')), 'headers.txt');
  const args = ['-sS', '--max-time', String(seconds), '-x', proxyUrl(proxy), '-D', headerFile];
  if (init.method && init.method !== 'GET') args.push('-X', init.method);
  for (const [key, value] of Object.entries(init.headers ?? {})) args.push('-H', `${key}: ${value}`);
  if (init.body !== undefined) args.push('--data-binary', init.body);
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 16 * 1024 * 1024 });
    const headers = readFileSync(headerFile, 'utf8');
    const status = Number(HTTP_STATUS_RE.exec(headers)?.[1] ?? 200);
    return new Response(stdout, { status });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`outbound request through ${proxy.kind} proxy failed: ${detail}`);
  } finally {
    try { unlinkSync(headerFile); } catch { /* already gone */ }
  }
}

/**
 * Connectivity probe for the Settings proxy test button. Reaches a tiny public
 * endpoint through the active proxy and reports the round-trip status.
 */
export async function probeOutboundProxy(): Promise<{ ok: boolean; detail: string; latencyMs?: number }> {
  const proxy = activeProxy();
  if (!proxy) {
    return { ok: false, detail: 'No outbound proxy is enabled.' };
  }
  const started = Date.now();
  try {
    const res = await outboundFetch('https://example.com/', { timeoutMs: 10000 });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, detail: `Connected, but the proxy returned HTTP ${res.status}.` };
    return { ok: true, detail: `Reached https://example.com via ${proxy.kind} (${proxy.host}:${proxy.port})`, latencyMs };
  } catch (err) {
    return {
      ok: false,
      detail: `Could not reach the ${proxy.kind} proxy at ${proxy.host}:${proxy.port}: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}