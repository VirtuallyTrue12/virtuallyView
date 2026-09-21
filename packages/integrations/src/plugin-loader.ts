import { IntegrationAdapter } from './adapter-interface.js';
import { getAdapter } from '../../server/src/services/registry.js';

export interface PluginInfo {
  id: string;
  name: string;
  adapter: IntegrationAdapter;
  version?: string;
  enabled: boolean;
}

export async function discoverPlugins(): Promise<PluginInfo[]> {
  const registry = getAdapter ? await import('../../server/src/services/registry.js').then(m => m.getManagedAdapters ? m.getManagedAdapters() : null) : null;
  if (!registry) return [];
  const adapters = registry ? Object.entries(registry) : [];
  const plugins: PluginInfo[] = [];
  for (const [key, adapter] of adapters) {
    try {
      const status = await adapter.getStatus();
      plugins.push({
        id: key,
        name: adapter.name,
        adapter,
        version: status.version,
        enabled: status.enabled ?? true
      });
    } catch {
      plugins.push({ id: key, name: adapter.name, adapter, enabled: false });
    }
  }
  return plugins;
}
