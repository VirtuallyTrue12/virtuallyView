import { readFileSync } from 'node:fs';

// FOO_API_KEY_FILE=/path reads the secret from a file into FOO_API_KEY, so keys
// generated at first boot (docker/secrets-init.sh) never sit in the Compose file.
for (const [name, path] of Object.entries(process.env)) {
  const match = /^(.+_API_KEY)_FILE$/.exec(name);
  if (!match || !path || process.env[match[1]!]) continue;
  try { process.env[match[1]!] = readFileSync(path, 'utf8').trim(); } catch { /* the file is optional */ }
}
