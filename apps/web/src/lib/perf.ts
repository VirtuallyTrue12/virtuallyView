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

const tvBrowser = () => /Android TV|BRAVIA|SmartTV|SMART-TV|AFT[A-Z]|Tizen|Web0S|webOS|BrowseHere|TV Bro|Silk/i.test(navigator.userAgent);

function apply(on: boolean) {
  lite = on;
  document.documentElement.classList.toggle('lite', on);
}

export function isLite(): boolean { return lite; }

export function initPerformanceMode(): void {
  // TVs are read from across the room: a larger interface there.
  if (tvBrowser()) document.documentElement.classList.add('tv');
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
