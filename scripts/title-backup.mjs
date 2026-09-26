#!/usr/bin/env node
/**
 * Back up and restore ONE TV show: its files, how the TV service (Sonarr) tracks it, which episodes are
 * monitored, and each person's watch progress. The dashboard's own backup covers accounts and settings but never
 * media; this is for keeping a single show safe while the rest of a library is rebuilt, or moving it.
 *
 *   node scripts/title-backup.mjs backup  "How I Met Your Mother" --out ~/Backups
 *   node scripts/title-backup.mjs restore ~/Backups/how-i-met-your-mother-20260926-1900
 *   node scripts/title-backup.mjs restore <backup folder> --adopt   (the files are already in place: check them and add the show)
 *
 * It talks to the stack through the docker CLI (Podman's docker shim works too) and to Sonarr's own API. Nothing is
 * deleted by this script. Restore refuses to overwrite a show that is already there.
 *
 * Options: --sonarr <container> (default: the container whose name contains "sonarr"), --app <container>
 * (default: the one containing "app-1"), --root <folder inside the Sonarr container> (default /media/tv).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DOCKER = process.env.DOCKER ?? 'docker';
const args = process.argv.slice(2);
const command = args.shift();
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; const [, v] = args.splice(i, 2); return v ?? fallback; };
const sh = (argv, input) => {
  const r = spawnSync(DOCKER, argv, { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${DOCKER} ${argv.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
};
const say = text => console.log(`[title-backup] ${text}`);

function findContainer(hint, override) {
  if (override) return override;
  const names = sh(['ps', '--format', '{{.Names}}']).split('\n').filter(Boolean);
  const found = names.find(n => n.includes(hint));
  if (!found) throw new Error(`No running container with "${hint}" in its name. Pass --${hint === 'sonarr' ? 'sonarr' : 'app'} <container>.`);
  return found;
}

const sonarrContainer = () => findContainer('sonarr', flag('sonarr'));
const appContainer = () => findContainer('app-1', flag('app'));

async function sonarrApi(container, method, path, body) {
  const key = sh(['exec', container, 'cat', '/secrets/sonarr']).trim();
  const script = `k='${key}'; curl -s -X ${method} -H "X-Api-Key: $k" -H "Content-Type: application/json" ${body === undefined ? '' : '--data-binary @-'} -w '\\n%{http_code}' "http://localhost:8989/api/v3${path}"`;
  const out = sh(['exec', '-i', container, 'sh', '-c', script], body === undefined ? undefined : JSON.stringify(body));
  const cut = out.lastIndexOf('\n');
  const status = Number(out.slice(cut + 1));
  const text = out.slice(0, cut);
  if (status >= 400) throw new Error(`Sonarr ${method} ${path} answered ${status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');

/** The rows of the dashboard's own database that belong to this show (progress, favorites, "continue watching"). */
function readAppRows(app, seriesLibraryId, episodeLibraryIds) {
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/app/apps/server/data/app.sqlite', { readOnly: true });
    const ep = new Set(${JSON.stringify(episodeLibraryIds)});
    const sid = ${JSON.stringify(seriesLibraryId)};
    const out = {
      watch_progress: db.prepare('SELECT * FROM watch_progress').all().filter(r => r.context === sid || (r.media_type === 'episode' && ep.has(r.media_id)) || r.media_id === sid),
      user_flags: db.prepare('SELECT * FROM user_flags').all().filter(r => (r.media_type === 'episode' && ep.has(r.media_id)) || (r.media_type === 'series' && r.media_id === sid)),
      series_last: db.prepare('SELECT * FROM series_last').all().filter(r => r.series_id === sid)
    };
    process.stdout.write(JSON.stringify(out));`;
  try { return JSON.parse(sh(['exec', app, 'node', '-e', script])); } catch (error) { say(`Could not read watch progress (${error.message}); the files and Sonarr settings are still saved.`); return { watch_progress: [], user_flags: [], series_last: [] }; }
}

async function backup() {
  const title = args.shift();
  const outRoot = resolve((flag('out', '.')).replace(/^~/, process.env.HOME ?? '~'));
  const root = flag('root', '/media/tv');
  if (!title) throw new Error('Usage: backup "<show title>" --out <folder>');
  const sonarr = sonarrContainer(), app = appContainer();
  const all = await sonarrApi(sonarr, 'GET', '/series');
  const series = all.find(s => s.title.toLowerCase() === title.toLowerCase()) ?? all.find(s => s.title.toLowerCase().includes(title.toLowerCase()));
  if (!series) throw new Error(`Sonarr has no show called "${title}". It has: ${all.map(s => s.title).join(', ')}`);
  const folder = series.path.replace(new RegExp(`^${root}/?`), '');
  if (!folder || folder.includes('..')) throw new Error(`Unexpected show folder "${series.path}".`);
  say(`Backing up "${series.title}" (${series.statistics.episodeFileCount} episode files, ${(series.statistics.sizeOnDisk / 1e9).toFixed(1)} GB) from ${series.path}`);

  const dir = resolve(outRoot, `${slug(series.title)}-${stamp()}`);
  mkdirSync(dir, { recursive: true });

  const episodes = await sonarrApi(sonarr, 'GET', `/episode?seriesId=${series.id}`);
  const episodeFiles = await sonarrApi(sonarr, 'GET', `/episodefile?seriesId=${series.id}`);
  const profiles = await sonarrApi(sonarr, 'GET', '/qualityprofile');
  const tags = await sonarrApi(sonarr, 'GET', '/tag');
  const app_data = readAppRows(app, `sonarr-${series.id}`, episodes.map(e => `episode-${e.id}`));

  say('Hashing every file (a checksum list is how the restore is proven)…');
  const manifest = sh(['exec', sonarr, 'sh', '-c', `cd "${root}" && find "${folder}" -type f -print0 | sort -z | xargs -0 sha256sum`]);
  writeFileSync(resolve(dir, 'files.sha256'), manifest);
  const fileCount = manifest.split('\n').filter(Boolean).length;

  say('Copying the files (this is the long part)…');
  const owner = sh(['exec', sonarr, 'sh', '-c', `stat -c '%u:%g' "${root}/${folder}"`]).trim();
  const tarPath = resolve(dir, 'files.tar');
  await new Promise((done, fail) => {
    const child = spawn(DOCKER, ['exec', sonarr, 'tar', 'cf', '-', '-C', root, folder], { stdio: ['ignore', 'pipe', 'inherit'] });
    const file = createWriteStream(tarPath);
    child.stdout.pipe(file);
    child.on('error', fail);
    file.on('error', fail);
    child.on('close', code => (code === 0 ? file.end(done) : fail(new Error(`tar exited with ${code}`))));
  });
  const tarBytes = statSync(tarPath).size;

  const meta = {
    format: 'virtuallyview-title-backup', version: 1, createdAt: new Date().toISOString(), kind: 'series',
    title: series.title, folder, root, owner, fileCount, tarBytes, sourceBytes: series.statistics.sizeOnDisk,
    qualityProfileName: profiles.find(p => p.id === series.qualityProfileId)?.name ?? null,
    tags: (series.tags ?? []).map(id => tags.find(t => t.id === id)?.label).filter(Boolean),
    series, episodes: episodes.map(e => ({ id: e.id, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, monitored: e.monitored, hasFile: e.hasFile, title: e.title })),
    episodeFiles: episodeFiles.map(f => ({ path: f.path, size: f.size, quality: f.quality?.quality?.name, releaseGroup: f.releaseGroup })),
    seriesLibraryId: `sonarr-${series.id}`, app_data
  };
  writeFileSync(resolve(dir, 'backup.json'), JSON.stringify(meta, null, 2));
  writeFileSync(resolve(dir, 'README.txt'), `Backup of "${series.title}" made ${meta.createdAt}.\nRestore it with:\n  node scripts/title-backup.mjs restore "${dir}"\n`);

  // Prove the archive is complete before anyone deletes anything.
  const listed = spawnSync('tar', ['tf', tarPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(l => l && !l.endsWith('/')).length;
  say(`Archive holds ${listed} files (${(tarBytes / 1e9).toFixed(1)} GB); Sonarr counts ${fileCount} on disk and ${series.statistics.episodeFileCount} episode files.`);
  if (listed !== fileCount) throw new Error(`The archive has ${listed} files but ${fileCount} were on disk. Do not delete anything; run the backup again.`);
  say(`Done: ${dir}`);
}

async function restore() {
  const adopt = args.includes('--adopt');
  if (adopt) args.splice(args.indexOf('--adopt'), 1);
  const dir = resolve((args.shift() ?? '').replace(/^~/, process.env.HOME ?? '~'));
  if (!existsSync(resolve(dir, 'backup.json'))) throw new Error('Pass the backup folder (the one that holds backup.json).');
  const meta = JSON.parse(readFileSync(resolve(dir, 'backup.json'), 'utf8'));
  const sonarr = sonarrContainer(), app = appContainer();
  const { series, folder, root } = meta;
  const existing = await sonarrApi(sonarr, 'GET', '/series');
  if (existing.some(s => s.tvdbId === series.tvdbId)) throw new Error(`"${series.title}" is already in Sonarr. Remove it first if you want to restore over it.`);
  const present = sh(['exec', sonarr, 'sh', '-c', `[ -e "${root}/${folder}" ] && echo yes || echo no`]).trim() === 'yes';
  if (present && !adopt) throw new Error(`${root}/${folder} already exists. Move it away, or add --adopt to use the files that are there.`);
  if (!present && adopt) throw new Error(`--adopt needs the files already in ${root}/${folder}; nothing is there.`);

  if (!adopt) {
    say(`Restoring "${meta.title}": copying ${meta.fileCount} files back…`);
    await new Promise((done, fail) => {
      const child = spawn(DOCKER, ['exec', '-i', sonarr, 'tar', 'xf', '-', '-C', root, '--no-same-owner'], { stdio: ['pipe', 'inherit', 'inherit'] });
      child.on('error', fail);
      child.on('close', code => (code === 0 ? done() : fail(new Error(`tar exited with ${code}`))));
      pipeline(createReadStream(resolve(dir, 'files.tar')), child.stdin).catch(fail);
    });
    sh(['exec', sonarr, 'sh', '-c', `chown -R ${meta.owner} "${root}/${folder}"`]);
  } else say(`Using the files already in ${root}/${folder}.`);

  say('Checking every file against its checksum…');
  const manifest = readFileSync(resolve(dir, 'files.sha256'), 'utf8');
  const now = sh(['exec', sonarr, 'sh', '-c', `cd "${root}" && find "${folder}" -type f -print0 | sort -z | xargs -0 sha256sum`]);
  if (now !== manifest) {
    const a = new Set(manifest.split('\n')), b = now.split('\n').filter(l => !a.has(l));
    throw new Error(`${b.length} file(s) differ from the backup, for example: ${b[0]}`);
  }
  say('All files match.');

  const profiles = await sonarrApi(sonarr, 'GET', '/qualityprofile');
  const profile = profiles.find(p => p.name === meta.qualityProfileName) ?? profiles[0];
  const body = {
    title: series.title, tvdbId: series.tvdbId, tmdbId: series.tmdbId, imdbId: series.imdbId, tvMazeId: series.tvMazeId, year: series.year,
    qualityProfileId: profile.id, seriesType: series.seriesType, seasonFolder: series.seasonFolder, monitored: series.monitored,
    useSceneNumbering: series.useSceneNumbering, path: series.path, rootFolderPath: root, seasons: series.seasons, images: series.images, tags: [],
    addOptions: { monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false }
  };
  const created = await sonarrApi(sonarr, 'POST', '/series', body);
  say(`Added to Sonarr as series ${created.id}; waiting for it to find the files…`);

  let filesFound = 0;
  for (let i = 0; i < 90 && filesFound < meta.episodeFiles.length; i++) {
    await new Promise(r => setTimeout(r, 4000));
    filesFound = (await sonarrApi(sonarr, 'GET', `/series/${created.id}`)).statistics?.episodeFileCount ?? 0;
    if (i === 8 && filesFound === 0) await sonarrApi(sonarr, 'POST', '/command', { name: 'RescanSeries', seriesId: created.id });
  }
  say(`Sonarr sees ${filesFound} of ${meta.episodeFiles.length} episode files.`);

  const episodes = await sonarrApi(sonarr, 'GET', `/episode?seriesId=${created.id}`);
  const key = e => `${e.seasonNumber}x${e.episodeNumber}`;
  const wasMonitored = new Set(meta.episodes.filter(e => e.monitored).map(key));
  const on = episodes.filter(e => wasMonitored.has(key(e))).map(e => e.id);
  const off = episodes.filter(e => !wasMonitored.has(key(e))).map(e => e.id);
  if (on.length) await sonarrApi(sonarr, 'PUT', '/episode/monitor', { episodeIds: on, monitored: true });
  if (off.length) await sonarrApi(sonarr, 'PUT', '/episode/monitor', { episodeIds: off, monitored: false });
  say(`Monitoring restored (${on.length} monitored, ${off.length} not).`);

  // Watch progress and favorites point at ids that changed; map them by season and episode number.
  const oldById = new Map(meta.episodes.map(e => [`episode-${e.id}`, key(e)]));
  const newByKey = new Map(episodes.map(e => [key(e), `episode-${e.id}`]));
  const oldSeries = meta.seriesLibraryId, newSeries = `sonarr-${created.id}`;
  const remap = id => (id === oldSeries ? newSeries : oldById.has(id) ? newByKey.get(oldById.get(id)) ?? id : id);
  const rows = meta.app_data ?? { watch_progress: [], user_flags: [], series_last: [] };
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/app/apps/server/data/app.sqlite');
    const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const put = (table, r) => { const cols = Object.keys(r); db.prepare('INSERT OR REPLACE INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')').run(...cols.map(c => r[c])); };
    for (const r of rows.watch_progress) put('watch_progress', r);
    for (const r of rows.user_flags) put('user_flags', r);
    for (const r of rows.series_last) put('series_last', r);
    process.stdout.write('ok');`;
  const mapped = {
    watch_progress: rows.watch_progress.map(r => ({ ...r, media_id: remap(r.media_id), ...(r.context ? { context: remap(r.context) } : {}) })),
    user_flags: rows.user_flags.map(r => ({ ...r, media_id: remap(r.media_id) })),
    series_last: rows.series_last.map(r => ({ ...r, series_id: remap(r.series_id), episode_id: remap(r.episode_id) }))
  };
  try { sh(['exec', '-i', app, 'node', '-e', script], JSON.stringify(mapped)); say(`Watch progress restored (${mapped.watch_progress.length} progress, ${mapped.user_flags.length} favorites/watched).`); }
  catch (error) { say(`Could not restore watch progress: ${error.message}`); }
  say(`Done. "${meta.title}" is back as ${newSeries}.`);
}

try {
  if (command === 'backup') await backup();
  else if (command === 'restore') await restore();
  else { console.log('Usage:\n  node scripts/title-backup.mjs backup "<show title>" --out <folder>\n  node scripts/title-backup.mjs restore <backup folder>'); process.exit(command ? 1 : 0); }
} catch (error) {
  console.error(`[title-backup] ${error.message}`);
  process.exit(1);
}
