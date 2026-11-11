/**
 * Every visualizer scene, fed by a real analyser playing made-up music (fixtures/viz), drawn without a page error
 * or a shader that fails to compile.
 */
import { chromium, type Browser } from 'playwright';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startVizHarness } from './fixtures/viz/harness';

let browser: Browser;
let server: ViteDevServer;
let url = '';

beforeAll(async () => {
  ({ url, server } = await startVizHarness());
  // The GPU when there is one, so the shader scenes really run (without one they fall back to the bars).
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('visualizer scenes', () => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    it(`draws every scene without errors (${reducedMotion} motion)`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion });
      try {
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (/visualizer (shader|program)/.test(m.text())) errors.push(m.text()); });
        await page.goto(url);
        await page.waitForFunction('Array.isArray(window.vizScenes)');
        const scenes = await page.evaluate('window.vizScenes') as string[];
        expect(scenes.length).toBeGreaterThan(30);
        for (const scene of [...scenes, 'cycle', 'mood']) {
          await page.evaluate(`window.vizScene(${JSON.stringify(scene)})`);
          await page.waitForSelector(`[data-scene="${scene}"] canvas`, { state: 'attached' });
          await page.waitForTimeout(250);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
