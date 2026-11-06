// Pure text edit: write the image crop into a card block's source.
import { DEFAULT_CROP, ImageCrop, clampZoom } from "./card";

const CROP_KEY = /^image_(pos|zoom|rotate)\s*:/;
const IMAGE_KEY = /^image\s*:/;

/**
 * Returns the block source (text between the fences) with `image_pos` /
 * `image_zoom` set to the given crop. Default values are omitted so a reset
 * removes the fields. The fields are placed right after `image:`, i.e. before
 * `description`, which swallows everything after it.
 */
export function setImageCrop(source: string, crop: ImageCrop): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").filter((l) => !CROP_KEY.test(l));

  const out: string[] = [];
  const pct = (v: number) => Math.round(v * 100);
  if (pct(crop.x) !== pct(DEFAULT_CROP.x) || pct(crop.y) !== pct(DEFAULT_CROP.y)) {
    out.push(`image_pos: ${pct(crop.x)}% ${pct(crop.y)}%`);
  }
  const zoom = Math.round(clampZoom(crop.zoom) * 100) / 100;
  if (zoom !== DEFAULT_CROP.zoom) out.push(`image_zoom: ${zoom}`);
  const rotate = Math.round(crop.rotate);
  if (rotate !== DEFAULT_CROP.rotate) out.push(`image_rotate: ${rotate}`);

  let at = lines.findIndex((l) => IMAGE_KEY.test(l));
  at = at === -1 ? 0 : at + 1;
  lines.splice(at, 0, ...out);
  return lines.join("\n");
}
