#!/usr/bin/env node
// Fails when the places that name the version disagree. Run in CI and before a release.
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const problems = [];

const release = readFileSync('docker-compose.release.yml', 'utf8');
for (const match of release.matchAll(/VV_VERSION:-([0-9.]+)/g)) {
  if (match[1] !== version) problems.push(`docker-compose.release.yml pins ${match[1]}, package.json says ${version}`);
}
const top = /^## (\S+)/m.exec(readFileSync('CHANGELOG.md', 'utf8'))?.[1];
if (top !== version) problems.push(`CHANGELOG.md starts with ${top}, package.json says ${version}`);

const ref = process.env.GITHUB_REF_NAME;
if (process.env.GITHUB_REF_TYPE === 'tag' && ref && ref.replace(/^v/, '') !== version) {
  problems.push(`the tag ${ref} does not match package.json ${version}`);
}

if (problems.length) {
  console.error(problems.map(p => `version mismatch: ${p}`).join('\n'));
  process.exit(1);
}
console.log(`version ${version} is consistent`);
