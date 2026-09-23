// A curated list of well-known Ollama models, since Ollama itself has no API
// to search its library - only /api/tags, which lists what is already pulled.
// Sizes are approximate (Q4 quantization, the Ollama default): actual RAM use
// varies with context length and what else is running on the machine.

export interface CatalogModel {
  tag: string;
  family: string;
  title: string;
  params: string;
  diskGB: number;
  ramGB: number;
  use: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  { tag: 'qwen2.5:0.5b', family: 'qwen', title: 'Qwen 2.5', params: '0.5B', diskGB: 0.4, ramGB: 1, use: 'Fast, tiny. The shipped default.' },
  { tag: 'qwen2.5:1.5b', family: 'qwen', title: 'Qwen 2.5', params: '1.5B', diskGB: 1, ramGB: 2, use: 'Noticeably sharper, still light.' },
  { tag: 'qwen2.5:3b', family: 'qwen', title: 'Qwen 2.5', params: '3B', diskGB: 1.9, ramGB: 3, use: 'Good balance for everyday questions.' },
  { tag: 'qwen2.5:7b', family: 'qwen', title: 'Qwen 2.5', params: '7B', diskGB: 4.7, ramGB: 6, use: 'Strong general assistant, tool use.' },
  { tag: 'qwen2.5:14b', family: 'qwen', title: 'Qwen 2.5', params: '14B', diskGB: 9, ramGB: 11, use: 'High quality, needs a capable machine.' },
  { tag: 'qwen2.5:32b', family: 'qwen', title: 'Qwen 2.5', params: '32B', diskGB: 20, ramGB: 24, use: 'Near top-tier reasoning, heavy.' },
  { tag: 'qwen2.5-coder:1.5b', family: 'qwen', title: 'Qwen 2.5 Coder', params: '1.5B', diskGB: 1, ramGB: 2, use: 'Small model tuned for code.' },
  { tag: 'qwen2.5-coder:7b', family: 'qwen', title: 'Qwen 2.5 Coder', params: '7B', diskGB: 4.7, ramGB: 6, use: 'Solid coding assistant.' },
  { tag: 'llama3.2:1b', family: 'llama', title: 'Llama 3.2', params: '1B', diskGB: 1.3, ramGB: 2, use: 'Meta\'s smallest current model.' },
  { tag: 'llama3.2:3b', family: 'llama', title: 'Llama 3.2', params: '3B', diskGB: 2, ramGB: 3, use: 'Small general-purpose assistant.' },
  { tag: 'llama3.1:8b', family: 'llama', title: 'Llama 3.1', params: '8B', diskGB: 4.7, ramGB: 6, use: 'Popular, well-rounded mid-size model.' },
  { tag: 'llama3.1:70b', family: 'llama', title: 'Llama 3.1', params: '70B', diskGB: 40, ramGB: 48, use: 'Large, needs a serious machine.' },
  { tag: 'phi3.5:3.8b', family: 'phi', title: 'Phi-3.5', params: '3.8B', diskGB: 2.2, ramGB: 4, use: 'Compact, strong at reasoning for its size.' },
  { tag: 'mistral:7b', family: 'mistral', title: 'Mistral', params: '7B', diskGB: 4.1, ramGB: 6, use: 'Solid all-rounder for tool use.' },
  { tag: 'mistral-nemo:12b', family: 'mistral', title: 'Mistral NeMo', params: '12B', diskGB: 7, ramGB: 9, use: 'Larger Mistral, long context.' },
  { tag: 'gemma2:2b', family: 'gemma', title: 'Gemma 2', params: '2B', diskGB: 1.6, ramGB: 3, use: 'Google\'s small open model.' },
  { tag: 'gemma2:9b', family: 'gemma', title: 'Gemma 2', params: '9B', diskGB: 5.5, ramGB: 7, use: 'Google open model, great quality.' },
  { tag: 'gemma2:27b', family: 'gemma', title: 'Gemma 2', params: '27B', diskGB: 16, ramGB: 19, use: 'Large Gemma, needs a lot of RAM.' },
  { tag: 'deepseek-r1:1.5b', family: 'deepseek', title: 'DeepSeek R1', params: '1.5B', diskGB: 1.1, ramGB: 2, use: 'Tiny reasoning model.' },
  { tag: 'deepseek-r1:7b', family: 'deepseek', title: 'DeepSeek R1', params: '7B', diskGB: 4.7, ramGB: 6, use: 'Reasoning-focused, thinks step by step.' },
  { tag: 'deepseek-r1:8b', family: 'deepseek', title: 'DeepSeek R1', params: '8B', diskGB: 4.9, ramGB: 6, use: 'Reasoning-focused, Llama-based.' },
  { tag: 'deepseek-r1:14b', family: 'deepseek', title: 'DeepSeek R1', params: '14B', diskGB: 9, ramGB: 11, use: 'Stronger reasoning, heavier.' },
  { tag: 'deepseek-r1:32b', family: 'deepseek', title: 'DeepSeek R1', params: '32B', diskGB: 20, ramGB: 24, use: 'High-end reasoning model.' },
  { tag: 'codellama:7b', family: 'codellama', title: 'Code Llama', params: '7B', diskGB: 3.8, ramGB: 5, use: 'Code-focused Llama variant.' },
  { tag: 'codellama:13b', family: 'codellama', title: 'Code Llama', params: '13B', diskGB: 7.4, ramGB: 9, use: 'Larger code-focused model.' },
  { tag: 'tinyllama:1.1b', family: 'tinyllama', title: 'TinyLlama', params: '1.1B', diskGB: 0.6, ramGB: 1, use: 'About as small as it gets.' }
];

export type Fit = 'fits' | 'tight' | 'too-big';

/** ramGB is the model's estimate; totalGB is this machine's total RAM. */
export function fitFor(ramGB: number, totalGB: number): Fit {
  if (totalGB <= 0) return 'tight';
  if (ramGB <= totalGB * 0.6) return 'fits';
  if (ramGB <= totalGB * 0.9) return 'tight';
  return 'too-big';
}

export function searchCatalog(query: string): CatalogModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODEL_CATALOG;
  return MODEL_CATALOG.filter(m =>
    m.tag.toLowerCase().includes(q) || m.family.toLowerCase().includes(q) || m.title.toLowerCase().includes(q)
  );
}
