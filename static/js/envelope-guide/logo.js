/**
 * Logo preparation. A JPEG can carry an EXIF orientation (phone photos and many scanned logos do): the browser
 * shows such a picture upright, but pdf-lib embeds the raw pixels and ignores the tag, so the sheet's preview and
 * its PDF would disagree. The orientation is applied once, here, when the file is chosen: the bytes the rest of
 * the page holds are already upright, with the tag gone, so the preview overlay and the PDF are the same picture.
 * The same step shrinks a large picture (see logoSize.js).
 */
import { jpegOrientation } from '/js/shared/exif-orientation.js';
import { logoTargetSize, logoShrinkSteps } from './logoSize.js';

export { jpegOrientation };

/**
 * Returns the logo as {bytes, type}, ready to hold and to draw: any EXIF orientation applied, and shrunk to at most
 * LOGO_MAX_EDGE pixels on its longest edge, so a phone photo or a large scan does not add megabytes to every sheet.
 * A JPEG stays a JPEG (quality 0.9, EXIF block dropped, so location and camera details do not travel), a PNG stays a
 * PNG (transparency survives). A picture that is already small and upright is returned untouched, and so is one the
 * browser cannot redraw, or one whose redrawn version would not be smaller.
 */
export async function prepareLogo(bytes, type) {
  try {
    const rotated = type === 'jpg' && jpegOrientation(bytes) !== 1;
    const mime = type === 'jpg' ? 'image/jpeg' : 'image/png';
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'from-image' });
    const target = logoTargetSize(bitmap.width, bitmap.height);
    if (!target && !rotated) { bitmap.close?.(); return { bytes, type }; }
    const steps = target ? logoShrinkSteps(bitmap.width, bitmap.height, target) : [{ width: bitmap.width, height: bitmap.height }];
    let source = bitmap;
    for (const step of steps) {
      const canvas = document.createElement('canvas');
      canvas.width = step.width;
      canvas.height = step.height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, step.width, step.height);
      if (source !== bitmap) source.width = source.height = 0;
      source = canvas;
    }
    bitmap.close?.();
    const blob = await new Promise((resolve) => source.toBlob(resolve, mime, 0.9));
    if (!blob) return { bytes, type };
    const out = new Uint8Array(await blob.arrayBuffer());
    if (!rotated && out.length >= bytes.length) return { bytes, type };
    return { bytes: out, type };
  } catch {
    return { bytes, type };
  }
}
