/**
 * How far a logo is shrunk. The logo prints at 30 mm at most, so 600 pixels on its longest edge is over 500 dpi;
 * anything larger only adds bytes to every envelope PDF. Pure arithmetic for the browser page, which shrinks on a
 * canvas; the command line has no canvas and refuses an oversize logo instead.
 *
 * In Chromium, with a 3.2 MB, 4000 x 3000 JPEG logo: the sheet is 86 KB with the shrink and 3.2 MB without; the live
 * preview re-renders in the same time either way (about 240 ms, mostly the debounce), so the shrink does not help the
 * preview; choosing the file takes 0.1 to 1.3 s with it and 30 ms without; and at 300 dpi a 16 mm and a 30 mm logo
 * differ from the unshrunk one by 1 to 2 grey levels of 255 on average, at edge pixels only, with no visible loss.
 * The benefit is the size of the saved and emailed sheet. A logo over the 4 MB cap is refused.
 */
export const LOGO_MAX_EDGE = 600;

/** A picture with more pixels than this is refused before it is decoded (a decompression bomb guard). */
export const LOGO_MAX_PIXELS = 40e6;

/**
 * The size to shrink to, or null when the picture is already at or under `maxEdge` on its longest edge (it is
 * never enlarged). The aspect ratio is kept and neither side goes below one pixel.
 */
export function logoTargetSize(width, height, maxEdge = LOGO_MAX_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The sizes to draw through on the way to `target`: halve while a half still stays at or above the target, then
 * the target itself. Drawing a large picture down in one go leaves jagged edges; stepping keeps them smooth.
 */
export function logoShrinkSteps(width, height, target) {
  const steps = [];
  let w = width; let h = height;
  while (Math.floor(w / 2) >= target.width && Math.floor(h / 2) >= target.height) {
    w = Math.floor(w / 2); h = Math.floor(h / 2);
    steps.push({ width: w, height: h });
  }
  if (!steps.length || steps[steps.length - 1].width !== target.width || steps[steps.length - 1].height !== target.height) {
    steps.push({ width: target.width, height: target.height });
  }
  return steps;
}
