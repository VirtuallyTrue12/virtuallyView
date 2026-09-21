import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

export type PermissionLevel = 'read' | 'request' | 'manage' | 'destructive';

const ORDER: PermissionLevel[] = ['read', 'request', 'manage', 'destructive'];
const DEFAULT_LEVEL: PermissionLevel = 'manage';
const PATH = resolve(DATA_DIR, 'ai-settings.json');

export function getPermissionLevel(): PermissionLevel {
  try {
    if (!existsSync(PATH)) return DEFAULT_LEVEL;
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as { permissionLevel?: PermissionLevel };
    return data.permissionLevel && ORDER.includes(data.permissionLevel) ? data.permissionLevel : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

export function setPermissionLevel(level: PermissionLevel): void {
  if (!ORDER.includes(level)) throw new Error(`Unknown permission level "${level}".`);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PATH, JSON.stringify({ permissionLevel: level }, null, 2), 'utf8');
}

export function isAllowed(toolPermission: PermissionLevel): boolean {
  return ORDER.indexOf(toolPermission) <= ORDER.indexOf(getPermissionLevel());
}

export function listPermissionLevels(): PermissionLevel[] {
  return [...ORDER];
}
