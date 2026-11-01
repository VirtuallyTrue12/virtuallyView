/**
 * Light mode for devices that cannot keep up with the full effects: TV browsers, and browsers drawing without
 * real graphics acceleration (software WebGL). It drops frosted-glass blur, big shadows and the background
 * visualizers; everything still works. Decided once at start (and once more from a short frame-rate check);
 * `localStorage['vv-lite']` = 'on' or 'off' overrides it.
 */
let lite = false;
let software: boolean | undefined;

/** True when the browser draws WebGL in software (no GPU), which also means video is decoded in software. */
export function softwareRendering(): boolean {
  if (software !== undefined) return software;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return (software = true);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { software = true; }
  return software;
}

const tvBrowser = () => /Android TV|BRAVIA|SmartTV|SMART-TV|AFT[A-Z]|Tizen|Web0S|webOS|BrowseHere|TV Bro|Silk|virtuallyViewTV/i.test(navigator.userAgent);

/** Running inside the virtuallyView Android TV app: video plays in the native player through VVNative. */
export const inTvApp = (): boolean => /virtuallyViewTV/.test(navigator.userAgent) && typeof window !== 'undefined' && 'VVNative' in window;

function apply(on: boolean) {
  lite = on;
  document.documentElement.classList.toggle('lite', on);
}

export function isLite(): boolean { return lite; }

/** The width a TV lays the page out at: the desktop layout, at a size that reads well from the sofa. */
export const TV_LAYOUT_WIDTH = 1280;

/**
 * Scale the whole page so a TV lays it out TV_LAYOUT_WIDTH wide, whatever width it reports. A 1080p Android TV's
 * web view reports only 960 wide (it draws two pixels per CSS pixel), which squeezed the page into a tablet layout
 * with everything doubled in size; a 4K or 1080p TV browser at one pixel each reports 1920 and looked tiny.
 */
export function tvZoom(viewportWidth: number): number {
  if (!(viewportWidth > 0)) return 1;
  return Math.round((viewportWidth / TV_LAYOUT_WIDTH) * 1000) / 1000;
}

function fitTv(): void {
  document.documentElement.style.setProperty('--tv-zoom', String(tvZoom(window.innerWidth)));
}

export function initPerformanceMode(): void {
  // TVs are read from across the room: a larger interface there.
  if (tvBrowser()) {
    document.documentElement.classList.add('tv');
    fitTv();
    window.addEventListener('resize', fitTv);
  }
  let forced: string | null = null;
  try { forced = localStorage.getItem('vv-lite'); } catch { /* none */ }
  if (forced === 'on' || forced === 'off') { apply(forced === 'on'); return; }
  apply(tvBrowser() || softwareRendering() || (navigator.hardwareConcurrency ?? 8) <= 2);
  if (lite) return;
  // A short check after the page settles: a machine that cannot hold even 40 frames a second idle gets light mode.
  window.setTimeout(() => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
      else if (!document.hidden && frames / 1.5 < 40) apply(true);
    };
    requestAnimationFrame(tick);
  }, 2500);
}

/** Once per browser: hardware acceleration is off, and how to turn it on (the one setting that fixes it all). */
export function accelerationTip(): string | null {
  if (!softwareRendering() || tvBrowser()) return null;
  try { if (localStorage.getItem('vv-accel-tip')) return null; localStorage.setItem('vv-accel-tip', '1'); } catch { return null; }
  const ua = navigator.userAgent;
  const where = /Firefox/.test(ua) ? 'Settings > General > Performance' : /Vivaldi/.test(ua) ? 'Settings > Webpages > Use hardware acceleration' : 'Settings > System > Use graphics acceleration';
  return `Hardware acceleration is off in this browser, so video and visuals run slowly. Turn it on in ${where}, then restart the browser.`;
}
