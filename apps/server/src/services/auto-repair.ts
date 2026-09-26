import { randomUUID } from 'node:crypto';
import { helperAction, helperStartAll, helperStatus } from './host-helper.js';
import { runTroubleshooting, type Check } from './troubleshoot.js';
import { runDoctor } from './download-doctor.js';
import { getServerSettings } from './server-settings.js';

/**
 * "Fix everything": one press does every repair the server can do by itself, in a sensible order,
 * and says in plain words what it did. What only the machine's owner can change (the helper container
 * missing, folder permissions) is named with the single command to run, never left as a mystery.
 */

export type StepStatus = 'pending' | 'running' | 'fixed' | 'ok' | 'failed' | 'needs-host';
export interface FixStep { id: string; label: string; status: StepStatus; message?: string }
export interface FixJob {
  id: string;
  startedAt: string;
  finishedAt?: string;
  steps: FixStep[];
  /** How many checks were not fine before and after, so the result can say "3 problems, 1 left". */
  before?: number;
  after?: number;
  /** One command to run on the server when something needs the machine's owner. */
  hostCommand?: string;
}

export const HOST_COMMAND = './scripts/repair.sh';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const problems = (checks: Check[]) => checks.filter(c => c.status === 'fail' || c.status === 'warn');

/** Services that share a network with the VPN must be restarted after it, never before. */
export function restartOrder(services: string[]): string[] {
  const rank = (name: string) => (name === 'vpngate-config' ? 0 : name === 'gluetun' ? 1 : name === 'qbittorrent' ? 3 : 2);
  const set = new Set(services);
  if (set.has('gluetun')) set.add('qbittorrent');
  return [...set].sort((a, b) => rank(a) - rank(b));
}

let current: FixJob | undefined;
export const currentFix = (): FixJob | undefined => current;

async function waitUntilStopped(service: string, maxMs: number): Promise<boolean> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await pause(4000);
    const status = await helperStatus();
    const row = status.data?.services.find(s => s.service === service);
    if (!row || row.state !== 'running') return true;
  }
  return false;
}

async function run(job: FixJob): Promise<void> {
  const step = (id: string, label: string): FixStep => { const s: FixStep = { id, label, status: 'pending' }; job.steps.push(s); return s; };
  const set = (s: FixStep, status: StepStatus, message?: string) => { s.status = status; if (message) s.message = message; };

  const look = step('look', 'Looking at everything');
  const helper = step('helper', 'Checking the repair helper');
  const start = step('start', 'Starting anything that stopped');
  const restart = step('restart', 'Restarting what is not answering');
  const setup = step('setup', 'Reconnecting the apps to each other');
  const downloads = step('downloads', 'Replacing dead downloads');
  const verify = step('verify', 'Checking again');

  set(look, 'running');
  const first = await runTroubleshooting();
  job.before = problems(first.checks).length;
  set(look, 'ok', job.before === 0 ? 'Nothing is wrong.' : `${job.before} thing${job.before === 1 ? '' : 's'} found.`);

  set(helper, 'running');
  const status = await helperStatus();
  const helperOn = status.ok;
  if (helperOn) set(helper, 'ok', 'The helper is on.');
  else {
    set(helper, 'needs-host', 'The helper that restarts services is not running, so this page cannot restart anything. One command on the server turns it on and fixes the rest.');
    job.hostCommand = HOST_COMMAND;
  }

  if (helperOn) {
    set(start, 'running');
    const started = await helperStartAll();
    const names = started.data?.started ?? [];
    set(start, names.length ? 'fixed' : 'ok', names.length ? `Started ${names.join(', ')}.` : 'Everything was already running.');
    if (names.length) await pause(15_000);

    set(restart, 'running');
    const broken = problems((await runTroubleshooting()).checks).flatMap(c => (c.restart ? [c.restart] : []));
    const order = restartOrder(broken);
    if (!order.length) set(restart, 'ok', 'Nothing needed restarting.');
    else {
      const done: string[] = [];
      const failed: string[] = [];
      for (const service of order) {
        const r = await helperAction(service, 'restart');
        (r.ok ? done : failed).push(service);
        if (service === 'gluetun') await pause(20_000);
      }
      await pause(20_000);
      set(restart, failed.length && !done.length ? 'failed' : 'fixed', `${done.length ? `Restarted ${done.join(', ')}.` : ''}${failed.length ? ` Could not restart ${failed.join(', ')}.` : ''}`.trim());
    }

    set(setup, 'running');
    const wiring = problems((await runTroubleshooting()).checks).some(c => c.id.startsWith('wiring-') || c.id === 'download-client') || !!order.length;
    if (!wiring) set(setup, 'ok', 'Everything is connected.');
    else {
      const r = await helperAction('provision', 'start');
      if (!r.ok) set(setup, 'needs-host', 'The setup step is not available here. Run it from the server.');
      else {
        await waitUntilStopped('provision', 240_000);
        set(setup, 'fixed', 'Ran the setup again: download folder, search sources and quality profiles are re-checked.');
      }
    }
  } else {
    for (const s of [start, restart, setup]) set(s, 'needs-host', 'Needs the helper.');
  }

  set(downloads, 'running');
  try {
    const result = await runDoctor({ force: true });
    const fixed = result.fixed.length;
    set(downloads, fixed ? 'fixed' : 'ok', fixed ? `Replaced ${fixed} download${fixed === 1 ? '' : 's'} that nobody was sharing.` : result.skippedBecauseOffline ? 'The server is offline, so nothing was changed.' : 'No download needed replacing.');
  } catch { set(downloads, 'failed', 'Could not look at the downloads.'); }

  set(verify, 'running');
  let last = await runTroubleshooting();
  // A service that was just restarted needs a moment before it answers: look once more before giving up.
  if (problems(last.checks).length > 0 && helperOn) { await pause(30_000); last = await runTroubleshooting(); }
  job.after = problems(last.checks).length;
  if (job.after > 0 && !job.hostCommand && problems(last.checks).some(c => !c.restart && c.status === 'fail')) job.hostCommand = HOST_COMMAND;
  set(verify, job.after === 0 ? 'fixed' : 'needs-host', job.after === 0 ? 'Everything is working.' : `${job.after} thing${job.after === 1 ? '' : 's'} still need${job.after === 1 ? 's' : ''} you (listed below).`);
  if (job.after === 0) job.hostCommand = undefined;
}

export function startFix(): FixJob {
  if (current && !current.finishedAt) return current;
  const job: FixJob = { id: randomUUID(), startedAt: new Date().toISOString(), steps: [] };
  current = job;
  void run(job).catch(err => {
    job.steps.push({ id: 'error', label: 'Something went wrong', status: 'failed', message: err instanceof Error ? err.message : 'Unknown error' });
  }).finally(() => { job.finishedAt = new Date().toISOString(); });
  return job;
}

let lastHeal = 0;
/**
 * The quiet version, on a timer: start what stopped (after a reboot or a sleep) and nothing more. It never
 * restarts a service that is running, so it cannot interrupt a download or a stream.
 */
export async function healQuietly(): Promise<string[]> {
  if (getServerSettings().autoRepair === false) return [];
  if (Date.now() - lastHeal < 4 * 60_000) return [];
  lastHeal = Date.now();
  const r = await helperStartAll();
  return r.ok ? r.data?.started ?? [] : [];
}

export function startAutoHeal(): void {
  setTimeout(() => void healQuietly().catch(() => undefined), 60_000).unref();
  setInterval(() => void healQuietly().catch(() => undefined), 5 * 60_000).unref();
}
