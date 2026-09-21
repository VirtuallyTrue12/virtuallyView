// Real imported-file playback. Never adds, removes, or downloads media.
// BASE_URL=http://127.0.0.1:3101 DASH_PASS=... node tests/e2e-local-playback.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Provide DASH_PASS');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let context;
try {
  context = await browser.newContext();
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { username: process.env.DASH_USER ?? 'root', password: process.env.DASH_PASS }
  });
  assert.equal(login.status(), 200);
  const response = await context.request.get(`${base}/api/movies`);
  assert.equal(response.status(), 200);
  const movies = await response.json();
  const movie = movies.find(item => item.title === (process.env.TEST_MOVIE ?? 'Dune: Part Two'));
  assert.ok(movie, 'Requested real movie must be in the library');
  assert.equal(movie.status, 'available', 'Imported movie must be available');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/movies/${encodeURIComponent(movie.id)}`);
  await page.getByRole('heading', { name: movie.title, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: `Play ${movie.title}`, exact: true }).click();
  await page.locator('video').waitFor();
  const src = await page.locator('video').getAttribute('src');
  assert.equal(new URL(src, base).pathname, `/api/stream/${movie.id}`, 'Must play selected local movie, never a sample trailer');
  await page.locator('video').evaluate(video => { video.muted = true; return video.play(); });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.currentTime > 2 && video.videoWidth > 0 && !video.error;
  }, undefined, { timeout: 45000 });
  const playback = await page.locator('video').evaluate(video => ({
    duration: video.duration, time: video.currentTime, width: video.videoWidth, height: video.videoHeight
  }));
  assert.ok(playback.duration > 600, 'Imported feature must not silently be a short sample trailer');
  const range = await context.request.get(`${base}/api/stream/${movie.id}`, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status(), 206);
  assert.equal((await range.body()).length, 1024);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${movie.title} detail -> local stream -> advancing video; ${JSON.stringify(playback)}; byte range verified`);
} finally {
  if (context) await context.request.post(`${base}/api/auth/logout`).catch(() => {});
  await browser.close();
}
