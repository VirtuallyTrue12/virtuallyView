#!/usr/bin/env node
/**
 * Runs once when the Docker Compose stack starts. Wires Radarr, Sonarr, and
 * Lidarr to qBittorrent as a download client, sets each app's root folder,
 * and registers Radarr/Sonarr/Lidarr as Applications in Prowlarr so its
 * indexers sync out automatically. Safe to run repeatedly: every step checks
 * for an existing entry before creating one.
 *
 * A few general-purpose public search sources are enabled by default (see
 * AUTO_INDEXERS below) so a fresh stack can find and download something
 * without a manual Prowlarr step. Set PROWLARR_AUTO_INDEXERS=none to disable
 * this, or to a comma-separated list of indexer definitions supported by the
 * installed Prowlarr version.
 */

// Radarr and Sonarr are on the Servarr v3 API; Lidarr (this version) is
// still on v1 for these same endpoints - confirmed against a real instance.
const RADARR = { name: 'Radarr', url: process.env.RADARR_URL, key: process.env.RADARR_API_KEY, rootFolder: '/media/movies', category: 'radarr', apiVersion: 'v3' };
const SONARR = { name: 'Sonarr', url: process.env.SONARR_URL, key: process.env.SONARR_API_KEY, rootFolder: '/media/tv', category: 'sonarr', apiVersion: 'v3' };
const LIDARR = { name: 'Lidarr', url: process.env.LIDARR_URL, key: process.env.LIDARR_API_KEY, rootFolder: '/media/music', category: 'lidarr', apiVersion: 'v1' };
const PROWLARR = { url: process.env.PROWLARR_URL, key: process.env.PROWLARR_API_KEY };
// Several sources, not one: Internet Archive is legal but sometimes throttles
// automated tools (see docs/troubleshooting.md), so two general-purpose public
// sources are added alongside it, so a request can still be found when one
// source is slow or unavailable. Comma-separated; PROWLARR_AUTO_INDEXER
// (singular, older installs) still works and is used in place of this.
const AUTO_INDEXERS = (process.env.PROWLARR_AUTO_INDEXER ?? process.env.PROWLARR_AUTO_INDEXERS ?? 'all-public')
  .split(',').map(s => s.trim()).filter(Boolean);
const QBIT = {
  host: process.env.QBITTORRENT_HOST ?? 'qbittorrent',
  port: Number(process.env.QBITTORRENT_PORT ?? 8080),
  username: process.env.QBITTORRENT_USERNAME ?? 'admin',
  password: process.env.QBITTORRENT_PASSWORD ?? 'adminadmin'
};
const NZBGET = {
  host: process.env.NZBGET_HOST ?? 'nzbget',
  port: Number(process.env.NZBGET_PORT ?? 6789),
  username: process.env.NZBGET_USERNAME ?? 'nzbget',
  password: process.env.NZBGET_PASSWORD ?? 'nzbget'
};

const APPS = [RADARR, SONARR, LIDARR];

function log(msg) {
  console.log(`[provision] ${msg}`);
}

async function waitForReady(app, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${app.url}/api/${app.apiVersion}/system/status`, {
        headers: { 'X-Api-Key': app.key },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function waitForProwlarr(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${PROWLARR.url}/api/v1/system/status`, {
        headers: { 'X-Api-Key': PROWLARR.key },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function firstId(app, headers, resource) {
  const res = await fetch(`${app.url}/api/${app.apiVersion}/${resource}`, { headers });
  if (!res.ok) return undefined;
  const list = await res.json();
  return list[0]?.id;
}

async function ensureRootFolder(app) {
  const headers = { 'X-Api-Key': app.key, 'Content-Type': 'application/json' };
  const res = await fetch(`${app.url}/api/${app.apiVersion}/rootfolder`, { headers });
  if (!res.ok) throw new Error(`${app.name}: could not list root folders (${res.status})`);
  const existing = await res.json();
  if (existing.some(f => f.path === app.rootFolder)) {
    log(`${app.name}: root folder ${app.rootFolder} already set`);
    return;
  }

  const body = { path: app.rootFolder };
  // Lidarr's rootfolder additionally requires a name and default profiles;
  // Radarr/Sonarr ignore these extra fields harmlessly if included.
  if (app.name === 'Lidarr') {
    body.name = 'Music';
    body.defaultMetadataProfileId = await firstId(app, headers, 'metadataprofile');
    body.defaultQualityProfileId = await firstId(app, headers, 'qualityprofile');
    body.defaultMonitorOption = 'all';
    body.defaultNewItemMonitorOption = 'all';
    body.defaultTags = [];
  }

  const create = await fetch(`${app.url}/api/${app.apiVersion}/rootfolder`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!create.ok) {
    const body = await create.text().catch(() => '');
    log(`${app.name}: could not set root folder ${app.rootFolder} (${create.status}). ${body}`);
    log(`${app.name}: this is usually a folder-permission issue - check that /media is writable by the container user (PUID/PGID in docker-compose.yml).`);
    return;
  }
  log(`${app.name}: root folder ${app.rootFolder} created`);
}

// Name files on import. Without it a release keeps its scene name
// ("Show.S01E01.1080p.WEB-DL-GROUP.mkv") and albums pile up in one folder.
async function ensureNaming(app) {
  const headers = { 'X-Api-Key': app.key, 'Content-Type': 'application/json' };
  const flag = { Radarr: 'renameMovies', Sonarr: 'renameEpisodes', Lidarr: 'renameTracks' }[app.name];
  if (!flag) return;
  try {
    const res = await fetch(`${app.url}/api/${app.apiVersion}/config/naming`, { headers });
    if (!res.ok) return;
    const naming = await res.json();
    if (naming[flag]) return;
    const put = await fetch(`${app.url}/api/${app.apiVersion}/config/naming`, { method: 'PUT', headers, body: JSON.stringify({ ...naming, [flag]: true }) });
    log(put.ok ? `${app.name}: file renaming switched on` : `${app.name}: could not switch on file renaming (${put.status})`);
  } catch (err) {
    log(`${app.name}: could not check file renaming (${err instanceof Error ? err.message : err})`);
  }
}

// Lidarr: refuse mono and low-bitrate releases. Release profiles are matched on
// the release name, so this catches "Mono", "128kbps" and similar. Lossless is
// preferred through the quality profile (default for artists).
async function ensureMusicPreferences(app) {
  const headers = { 'X-Api-Key': app.key, 'Content-Type': 'application/json' };
  const name = 'virtuallyView: best audio';
  try {
    const list = await fetch(`${app.url}/api/v1/releaseprofile`, { headers });
    if (!list.ok) return;
    // Lidarr's release profiles have no name, so recognise ours by what it ignores.
    if ((await list.json()).some(p => p.name === name || (Array.isArray(p.ignored) && p.ignored.includes('mono') && p.ignored.includes('128kbps')))) return;
    const body = {
      name, enabled: true, indexerId: 0, tags: [],
      required: [],
      ignored: ['mono', 'mono mix', 'mono version', 'in mono', '64kbps', '96kbps', '128kbps', '128 kbps', '160kbps', 'karaoke', 'live bootleg'],
    };
    const res = await fetch(`${app.url}/api/v1/releaseprofile`, { method: 'POST', headers, body: JSON.stringify(body) });
    log(res.ok ? 'Lidarr: ignoring mono and low-bitrate releases' : `Lidarr: could not add the audio preference profile (${res.status})`);
  } catch (err) {
    log(`Lidarr: could not set audio preferences (${err instanceof Error ? err.message : err})`);
  }
}

// Bazarr: connect to Radarr and Sonarr, add keyless subtitle sources, create one
// language profile and give new titles that profile.
async function ensureBazarr() {
  const key = process.env.BAZARR_API_KEY;
  const url = process.env.BAZARR_URL;
  if (!url || !key) return;
  const languages = (process.env.SUBTITLE_LANGUAGES ?? 'en').split(',').map(l => l.trim().toLowerCase()).filter(Boolean);
  const post = async fields => {
    const form = new URLSearchParams();
    for (const [name, value] of fields) form.append(name, value);
    return fetch(`${url}/api/system/settings`, { method: 'POST', headers: { 'X-API-KEY': key }, body: form });
  };
  try {
    const status = await fetch(`${url}/api/system/status`, { headers: { 'X-API-KEY': key }, signal: AbortSignal.timeout(20_000) });
    if (!status.ok) {
      log(`Bazarr: the API key was refused (${status.status}). If Bazarr started before this stack was seeded, copy its key from Settings > General into BAZARR_API_KEY.`);
      return;
    }
    const profile = [{
      profileId: 1, name: 'Default', cutoff: null, mustContain: [], mustNotContain: [], originalFormat: false,
      items: languages.map((language, i) => ({ id: i + 1, language, audio_exclude: 'False', audio_only_include: 'False', hi: 'False', forced: 'False' }))
    }];
    const base = [
      ...languages.map(l => ['languages-enabled', l]),
      ['languages-profiles', JSON.stringify(profile)],
      ['settings-general-use_radarr', 'true'], ['settings-general-use_sonarr', 'true'],
      ['settings-radarr-ip', 'radarr'], ['settings-radarr-port', '7878'], ['settings-radarr-apikey', RADARR.key], ['settings-radarr-base_url', '/'], ['settings-radarr-ssl', 'false'],
      ['settings-sonarr-ip', 'sonarr'], ['settings-sonarr-port', '8989'], ['settings-sonarr-apikey', SONARR.key], ['settings-sonarr-base_url', '/'], ['settings-sonarr-ssl', 'false'],
      ['settings-general-movie_default_enabled', 'true'], ['settings-general-movie_default_profile', '1'],
      ['settings-general-serie_default_enabled', 'true'], ['settings-general-serie_default_profile', '1']
    ];
    const first = await post(base);
    log(first.ok ? 'Bazarr: connected to Radarr and Sonarr, language profile created' : `Bazarr: could not save its connections (${first.status})`);
    // Sources that need no account. A wrong name is rejected on its own without losing the rest.
    for (const provider of ['podnapisi', 'yifysubtitles', 'tvsubtitles', 'gestdown', 'subf2m', 'subtitlecat', 'embeddedsubtitles']) {
      const current = await fetch(`${url}/api/system/settings`, { headers: { 'X-API-KEY': key } }).then(r => r.json()).catch(() => ({}));
      const enabled = current?.general?.enabled_providers ?? [];
      if (enabled.includes(provider)) continue;
      const res = await post([...enabled, provider].map(p => ['settings-general-enabled_providers', p]));
      if (!res.ok) log(`Bazarr: subtitle source ${provider} was not accepted (${res.status})`);
    }
  } catch (err) {
    log(`Bazarr: could not be set up (${err instanceof Error ? err.message : err})`);
  }
}

async function ensureDownloadClient(app, client) {
  const headers = { 'X-Api-Key': app.key, 'Content-Type': 'application/json' };
  const res = await fetch(`${app.url}/api/${app.apiVersion}/downloadclient`, { headers });
  if (!res.ok) throw new Error(`${app.name}: could not list download clients (${res.status})`);
  const existing = await res.json();
  if (existing.some(c => c.name === client.name)) {
    log(`${app.name}: ${client.name} download client already configured`);
    return;
  }
  const create = await fetch(`${app.url}/api/${app.apiVersion}/downloadclient`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      enable: true,
      protocol: client.protocol,
      priority: 1,
      name: client.name,
      implementation: client.implementation,
      configContract: client.configContract,
      fields: client.fields(app)
    })
  });
  if (!create.ok) {
    const body = await create.text().catch(() => '');
    log(`${app.name}: could not add ${client.name} as a download client (${create.status}). ${body}`);
    return;
  }
  log(`${app.name}: ${client.name} added as a download client`);
}

const DOWNLOAD_CLIENTS = [
  {
    name: 'qBittorrent',
    protocol: 'torrent',
    implementation: 'QBittorrent',
    configContract: 'QBittorrentSettings',
    fields: app => [
      { name: 'host', value: QBIT.host }, { name: 'port', value: QBIT.port },
      { name: 'username', value: QBIT.username }, { name: 'password', value: QBIT.password },
      { name: 'category', value: app.category }, { name: 'useSsl', value: false }
    ]
  },
  {
    name: 'NZBGet',
    protocol: 'usenet',
    implementation: 'Nzbget',
    configContract: 'NzbgetSettings',
    fields: app => {
      const mediaPrefix = app.name === 'Sonarr' ? 'Tv' : app.name === 'Lidarr' ? 'Music' : 'Movie';
      const category = app.name === 'Sonarr' ? 'Series' : app.name === 'Lidarr' ? 'Music' : 'Movies';
      return [
      { name: 'host', value: NZBGET.host }, { name: 'port', value: NZBGET.port },
      { name: 'useSsl', value: false }, { name: 'urlBase', value: null },
      { name: 'username', value: NZBGET.username }, { name: 'password', value: NZBGET.password },
      { name: `${mediaPrefix.toLowerCase()}Category`, value: category },
      { name: `recent${mediaPrefix}Priority`, value: 0 }, { name: `older${mediaPrefix}Priority`, value: 0 },
      { name: 'addPaused', value: false }
      ];
    }
  }
];

async function ensureProwlarrApplication(app, implementation) {
  const headers = { 'X-Api-Key': PROWLARR.key, 'Content-Type': 'application/json' };
  const res = await fetch(`${PROWLARR.url}/api/v1/applications`, { headers });
  if (!res.ok) throw new Error(`Prowlarr: could not list applications (${res.status})`);
  const existing = await res.json();
  if (existing.some(a => a.name === implementation)) {
    log(`Prowlarr: ${implementation} application already registered`);
    return;
  }
  const create = await fetch(`${PROWLARR.url}/api/v1/applications`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: implementation,
      implementation,
      configContract: `${implementation}Settings`,
      syncLevel: 'addOnly',
      fields: [
        { name: 'prowlarrUrl', value: PROWLARR.url },
        { name: 'baseUrl', value: app.url },
        { name: 'apiKey', value: app.key }
      ]
    })
  });
  if (!create.ok) {
    const body = await create.text().catch(() => '');
    log(`Prowlarr: could not register ${implementation} (${create.status}). ${body}`);
    return;
  }
  log(`Prowlarr: registered ${implementation} - its indexers will sync automatically once you add some`);
}

/** Add one search source, skipping it quietly if it is already there or unknown to this Prowlarr version. */
const ADULT_WORDS = /porn|xxx|adult|hentai|18\+|\bsex|erotic|nsfw|\bjav\b/i;
function isAdult(schema) {
  const ids = (schema.capabilities?.categories ?? []).map(c => Number(c.id)).filter(n => Number.isFinite(n) && n < 100000);
  return (ids.length > 0 && ids.every(id => id >= 6000 && id < 7000)) || ADULT_WORDS.test(`${schema.name} ${schema.description ?? ''}`);
}

async function addIndexerFromSchema(schema, headers, { test, tags = [] }) {
  const fields = schema.fields.map(field => {
    const value = field.name === 'baseUrl' ? schema.indexerUrls?.[0] : field.value;
    return value === undefined ? { name: field.name } : { name: field.name, value };
  });
  // test=true: Prowlarr test-connects before saving, so only sources that answer
  // right now are kept. test=false (forceSave): save even if the site is slow.
  const create = await fetch(`${PROWLARR.url}/api/v1/indexer${test ? '' : '?forceSave=true'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      enable: true, redirect: false, name: schema.name, implementation: schema.implementation,
      implementationName: schema.implementationName, configContract: schema.configContract,
      protocol: schema.protocol, privacy: schema.privacy, priority: schema.priority ?? 25, fields, tags,
      appProfileId: (await firstProwlarrAppProfileId(headers)) ?? 1
    }),
    signal: AbortSignal.timeout(60000)
  });
  return create.ok ? { ok: true } : { ok: false, body: await create.text().catch(() => '') };
}

async function ensureOneIndexer(definitionName, headers, existing) {
  if (existing.some(indexer => indexer.definitionName === definitionName || indexer.name?.toLowerCase() === definitionName.toLowerCase())) {
    log(`Prowlarr: ${definitionName} already configured`);
    return;
  }
  const schemaResponse = await fetch(`${PROWLARR.url}/api/v1/indexer/schema`, { headers });
  if (!schemaResponse.ok) throw new Error(`Prowlarr: could not load indexer schemas (${schemaResponse.status})`);
  const schema = (await schemaResponse.json()).find(item => item.definitionName === definitionName);
  if (!schema) {
    log(`Prowlarr: indexer definition "${definitionName}" is not available in this Prowlarr version, skipping`);
    return;
  }
  const result = await addIndexerFromSchema(schema, headers, { test: false });
  log(result.ok ? `Prowlarr: added ${schema.name} as a search source` : `Prowlarr: could not add ${schema.name}. ${result.body}`.trim());
}

/** Every public, non-adult source that answers. Ones behind Cloudflare are retried through FlareSolverr. */
async function ensureAllPublicIndexers(headers, existing) {
  const schemaResponse = await fetch(`${PROWLARR.url}/api/v1/indexer/schema`, { headers });
  if (!schemaResponse.ok) throw new Error(`Prowlarr: could not load indexer schemas (${schemaResponse.status})`);
  const have = new Set(existing.flatMap(i => [i.definitionName, i.name?.toLowerCase()]));
  const todo = (await schemaResponse.json()).filter(sc => sc.privacy === 'public' && !isAdult(sc) && !have.has(sc.definitionName) && !have.has(sc.name?.toLowerCase()));
  const tagId = await ensureFlareSolverr(headers);
  log(`Prowlarr: trying ${todo.length} public sources (adult ones are never added automatically)`);
  let added = 0, viaFlare = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const schema = todo[next++];
      try {
        let r = await addIndexerFromSchema(schema, headers, { test: true });
        if (!r.ok && tagId && /cloudflare|ddos|captcha|challenge|403|forbidden/i.test(r.body)) {
          r = await addIndexerFromSchema(schema, headers, { test: true, tags: [tagId] });
          if (r.ok) viaFlare++;
        }
        if (r.ok) added++;
      } catch { /* a slow site must not stop the rest */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  log(`Prowlarr: ${added} of ${todo.length} public sources are working and were added (${viaFlare} through FlareSolverr). The rest are retried on the next start.`);
}

async function ensureFlareSolverr(headers) {
  const host = process.env.FLARESOLVERR_URL ?? 'http://flaresolverr:8191';
  try {
    const up = await fetch(host, { signal: AbortSignal.timeout(4000) });
    if (!up.ok) return undefined;
    const tags = await (await fetch(`${PROWLARR.url}/api/v1/tag`, { headers })).json();
    let tag = tags.find(t => t.label === 'flaresolverr');
    if (!tag) tag = await (await fetch(`${PROWLARR.url}/api/v1/tag`, { method: 'POST', headers, body: JSON.stringify({ label: 'flaresolverr' }) })).json();
    const proxies = await (await fetch(`${PROWLARR.url}/api/v1/indexerProxy`, { headers })).json();
    if (!proxies.some(p => p.implementation === 'FlareSolverr')) {
      const schema = (await (await fetch(`${PROWLARR.url}/api/v1/indexerProxy/schema`, { headers })).json()).find(p => p.implementation === 'FlareSolverr');
      if (schema) {
        const fields = schema.fields.map(f => ({ name: f.name, value: f.name === 'host' ? host : f.value }));
        await fetch(`${PROWLARR.url}/api/v1/indexerProxy`, { method: 'POST', headers, body: JSON.stringify({ ...schema, name: 'FlareSolverr', fields, tags: [tag.id] }) });
      }
    }
    return tag.id;
  } catch {
    return undefined;
  }
}


/**
 * qBittorrent must save where the *arr apps can see the files (the shared
 * /downloads volume). Its own default is inside its config volume, which
 * Radarr/Sonarr/Lidarr cannot read, so finished downloads never import.
 * Existing torrents are moved, not deleted, so they keep seeding.
 */
async function ensureQbitSavePath() {
  const base = `http://${QBIT.host}:${QBIT.port}`;
  const login = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
    body: new URLSearchParams({ username: QBIT.username, password: QBIT.password })
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!login.ok || !cookie) throw new Error('qBittorrent: could not sign in to set the download folder');
  const headers = { Cookie: cookie, Referer: base };
  const prefs = await (await fetch(`${base}/api/v2/app/preferences`, { headers })).json();
  if (prefs.save_path !== '/downloads') {
    await fetch(`${base}/api/v2/app/setPreferences`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ json: JSON.stringify({ save_path: '/downloads', temp_path_enabled: false }) })
    });
    log('qBittorrent: downloads now save to the shared /downloads folder');
  }
  const torrents = await (await fetch(`${base}/api/v2/torrents/info`, { headers })).json();
  const stray = torrents.filter(t => !String(t.save_path).startsWith('/downloads'));
  if (stray.length) {
    await fetch(`${base}/api/v2/torrents/setLocation`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: stray.map(t => t.hash).join('|'), location: '/downloads' })
    });
    log(`qBittorrent: moved ${stray.length} download(s) to /downloads so the *arr apps can import them`);
  }
}

async function ensureProwlarrIndexer() {
  if (!AUTO_INDEXERS.length || AUTO_INDEXERS.every(name => name.toLowerCase() === 'none')) {
    log('Prowlarr: automatic indexer setup disabled');
    return;
  }

  const headers = { 'X-Api-Key': PROWLARR.key, 'Content-Type': 'application/json' };
  const existingResponse = await fetch(`${PROWLARR.url}/api/v1/indexer`, { headers });
  if (!existingResponse.ok) {
    throw new Error(`Prowlarr: could not list indexers (${existingResponse.status})`);
  }
  const existing = await existingResponse.json();
  // Each source is independent: one failing (a site down, blocked by an ISP,
  // behind Cloudflare) must not stop the others from being added.
  for (const definitionName of AUTO_INDEXERS) {
    if (definitionName.toLowerCase() === 'none') continue;
    if (definitionName.toLowerCase() === 'all-public') {
      try { await ensureAllPublicIndexers(headers, existing); } catch (err) { log(`Prowlarr: all-public - ${err instanceof Error ? err.message : err}`); }
      continue;
    }
    try {
      await ensureOneIndexer(definitionName, headers, existing);
    } catch (err) {
      log(`Prowlarr: ${definitionName} - ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function firstProwlarrAppProfileId(headers) {
  const response = await fetch(`${PROWLARR.url}/api/v1/appprofile`, { headers });
  if (!response.ok) return undefined;
  const profiles = await response.json();
  return profiles[0]?.id;
}

async function syncProwlarrApplications() {
  const headers = { 'X-Api-Key': PROWLARR.key, 'Content-Type': 'application/json' };
  const response = await fetch(`${PROWLARR.url}/api/v1/command`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'ApplicationIndexerSync', forceSync: true })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Prowlarr: could not sync indexers to Arr applications (${response.status}). ${body}`.trim());
  }
  log('Prowlarr: synchronization with Radarr, Sonarr, and Lidarr started');
}

async function main() {
  if (!PROWLARR.url || !PROWLARR.key || APPS.some(a => !a.url || !a.key)) {
    log('Missing RADARR_URL/RADARR_API_KEY, SONARR_URL/SONARR_API_KEY, LIDARR_URL/LIDARR_API_KEY, or PROWLARR_URL/PROWLARR_API_KEY. Skipping.');
    return;
  }

  log('Waiting for Radarr, Sonarr, Lidarr, and Prowlarr to come online...');
  const ready = await Promise.all([...APPS.map(a => waitForReady(a)), waitForProwlarr()]);
  if (ready.some(r => !r)) {
    log('One or more services did not come online in time. Nothing was configured; they will still work if you set them up manually in Settings.');
    return;
  }

  // Each step runs on its own: one failure (a slow website, a service that is
  // still starting) is reported and the rest of the setup carries on.
  const failed = [];
  const step = async (label, run) => {
    try { await run(); } catch (err) { failed.push(label); log(`${label}: ${err instanceof Error ? err.message : err}`); }
  };
  await step('qBittorrent download folder', () => ensureQbitSavePath());
  for (const app of APPS) {
    await step(`${app.name} root folder`, () => ensureRootFolder(app));
    await step(`${app.name} file renaming`, () => ensureNaming(app));
    if (app === LIDARR) await step('Lidarr audio preferences', () => ensureMusicPreferences(app));
    for (const client of DOWNLOAD_CLIENTS) await step(`${app.name} download client`, () => ensureDownloadClient(app, client));
  }
  await step('Prowlarr link to Radarr', () => ensureProwlarrApplication(RADARR, 'Radarr'));
  await step('Prowlarr link to Sonarr', () => ensureProwlarrApplication(SONARR, 'Sonarr'));
  await step('Prowlarr link to Lidarr', () => ensureProwlarrApplication(LIDARR, 'Lidarr'));
  await step('Prowlarr search sources', () => ensureProwlarrIndexer());
  await step('Prowlarr sync', () => syncProwlarrApplications());
  await step('Bazarr subtitles', () => ensureBazarr());

  if (failed.length) {
    log(`Finished with ${failed.length} step${failed.length === 1 ? '' : 's'} left to retry: ${failed.join(', ')}. Run the setup again from virtuallyView (Home or Settings) once the services are up.`);
    process.exitCode = 3;
    return;
  }
  log('Done. Radarr, Sonarr, and Lidarr are wired to qBittorrent and registered with Prowlarr.');
  log('Additional indexers can be added in Prowlarr under Settings -> Indexers.');
}

main().catch(err => {
  console.error('[provision] failed:', err);
  process.exit(0); // never block the stack from coming up over a provisioning hiccup
});
