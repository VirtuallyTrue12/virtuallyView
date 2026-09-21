import { ToolCall } from './provider-interface.js';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  permission: 'read' | 'request' | 'manage' | 'destructive';
  requiresConfirmation: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools: Map<string, ToolSchema> = new Map();

  register(tool: ToolSchema) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolSchema | undefined {
    return this.tools.get(name);
  }

  list(): ToolSchema[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: Record<string, unknown>) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.execute(args);
  }
}
