// Pure card parsing/validation. No Obsidian imports so it can be unit-tested headlessly.

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "very rare",
  "legendary",
  "artifact",
] as const;
export type RarityClass = (typeof RARITIES)[number] | "unknown";

export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const LIMITS = {
  name: 200,
  short: 120,
  image: 2000,
  description: 20000,
} as const;

/**
 * Image placement. x/y: alignment 0..1 (like CSS object-position).
 * zoom: 1 = image just covers the frame; <1 shrinks it (transparent space
 * around it), >1 enlarges. rotate: degrees about the image centre.
 */
export interface ImageCrop {
  x: number;
  y: number;
  zoom: number;
  rotate: number;
}
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const MAX_ROTATE = 360;
export const DEFAULT_CROP: ImageCrop = { x: 0.5, y: 0.5, zoom: 1, rotate: 0 };
/** Image frame aspect ratio (width / height); fixed by the CSS (160u x 70u). */
export const FRAME_ASPECT = 160 / 70;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);

/**
 * Where the image sits inside the frame, as fractions of the frame size.
 * The image always covers the frame; zoom scales it up from there.
 * `ratio` is the image's natural width / height.
 */
export function imageRect(ratio: number, crop: ImageCrop) {
  const z = clampZoom(crop.zoom);
  const width = Math.max(1, ratio / FRAME_ASPECT) * z;
  const height = Math.max(1, FRAME_ASPECT / ratio) * z;
  return {
    width,
    height,
    left: (1 - width) * clamp(crop.x, 0, 1),
    top: (1 - height) * clamp(crop.y, 0, 1),
  };
}

/** New crop after dragging the image by (dx, dy), given as fractions of the frame. */
export function dragCrop(start: ImageCrop, dx: number, dy: number, ratio: number): ImageCrop {
  const { width, height } = imageRect(ratio, start);
  return {
    zoom: start.zoom,
    rotate: start.rotate,
    // Works for both larger (width>1) and smaller (width<1) than the frame.
    x: Math.abs(1 - width) > 0.0001 ? clamp(start.x + dx / (1 - width), 0, 1) : start.x,
    y: Math.abs(1 - height) > 0.0001 ? clamp(start.y + dy / (1 - height), 0, 1) : start.y,
  };
}

function parseImagePos(v: unknown): { x: number; y: number } | { error: string } {
  const bad = { error: `"image_pos" must be two percentages, like: 40% 25%` };
  let parts: unknown[];
  if (Array.isArray(v)) parts = v;
  else if (typeof v === "string") parts = v.trim().split(/[\s,]+/);
  else return bad;
  if (parts.length !== 2) return bad;
  const nums = parts.map((p) => Number(String(p).replace(/%$/, "")));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return bad;
  return { x: nums[0] / 100, y: nums[1] / 100 };
}

export interface Card {
  name: string;
  image?: string;
  imageCrop: ImageCrop;
  type: string;
  subtype?: string;
  rarity?: string;
  rarityClass: RarityClass;
  attunement?: string; // already display-ready, e.g. "Requires attunement"
  price?: string;
  textAlign: TextAlign;
  description: string;
}

export type ParseResult =
  | { ok: true; card: Card }
  | { ok: false; error: string };

export const DEFAULT_TYPE = "Wondrous Item";

function str(
  value: unknown,
  field: string,
  max: number,
): { value?: string; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" && typeof value !== "number") {
    return { error: `"${field}" must be text.` };
  }
  const s = String(value).trim();
  if (s.length > max) {
    return { error: `"${field}" is too long (max ${max} characters).` };
  }
  return s === "" ? {} : { value: s };
}

export function rarityClassOf(rarity: string | undefined): RarityClass {
  if (!rarity) return "unknown";
  const normalized = rarity.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return (RARITIES as readonly string[]).includes(normalized)
    ? (normalized as RarityClass)
    : "unknown";
}

/** Slug used for CSS classes. Always comes from the fixed enum, never raw input. */
export function rarityCssSuffix(r: RarityClass): string {
  return r.replace(" ", "-");
}

function formatAttunement(value: unknown): { value?: string; error?: string } {
  if (value === undefined || value === null || value === false) return {};
  if (value === true) return { value: "Requires attunement" };
  const r = str(value, "attunement", LIMITS.short);
  if (r.error || r.value === undefined) return r;
  // "by a wizard" -> "Requires attunement by a wizard"
  return {
    value: /^requires\b/i.test(r.value)
      ? r.value
      : `Requires attunement ${r.value}`.replace(/\s+/g, " "),
  };
}

/** "500", 500 -> "500 gp"; "500 sp" kept as-is. */
export function formatPrice(value: unknown): { value?: string; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value: `${value} gp` } : { error: `"price" is not a valid number.` };
  }
  const r = str(value, "price", LIMITS.short);
  if (r.error || r.value === undefined) return r;
  return /^[\d.,]+$/.test(r.value) ? { value: `${r.value} gp` } : { value: r.value };
}

export function parseCard(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Card must be a YAML mapping (key: value lines)." };
  }
  const o = raw as Record<string, unknown>;

  const name = str(o.name, "name", LIMITS.name);
  if (name.error) return { ok: false, error: name.error };
  if (!name.value) return { ok: false, error: `Missing required field "name".` };

  const image = str(o.image, "image", LIMITS.image);
  const type = str(o.type, "type", LIMITS.short);
  const subtype = str(o.subtype, "subtype", LIMITS.short);
  const rarity = str(o.rarity, "rarity", LIMITS.short);
  const description = str(o.description, "description", LIMITS.description);
  for (const r of [image, type, subtype, rarity, description]) {
    if (r.error) return { ok: false, error: r.error };
  }
  const attunement = formatAttunement(o.attunement);
  if (attunement.error) return { ok: false, error: attunement.error };
  const price = formatPrice(o.price);
  if (price.error) return { ok: false, error: price.error };

  const imageCrop: ImageCrop = { ...DEFAULT_CROP };
  if (o.image_pos !== undefined && o.image_pos !== null) {
    const p = parseImagePos(o.image_pos);
    if ("error" in p) return { ok: false, error: p.error };
    imageCrop.x = p.x;
    imageCrop.y = p.y;
  }
  if (o.image_zoom !== undefined && o.image_zoom !== null) {
    const z = Number(o.image_zoom);
    if (!Number.isFinite(z) || z < MIN_ZOOM || z > MAX_ZOOM) {
      return { ok: false, error: `"image_zoom" must be a number from ${MIN_ZOOM} to ${MAX_ZOOM}.` };
    }
    imageCrop.zoom = z;
  }
  if (o.image_rotate !== undefined && o.image_rotate !== null) {
    const d = Number(o.image_rotate);
    if (!Number.isFinite(d) || Math.abs(d) > MAX_ROTATE) {
      return { ok: false, error: `"image_rotate" must be degrees from -${MAX_ROTATE} to ${MAX_ROTATE}.` };
    }
    imageCrop.rotate = d;
  }

  let textAlign: TextAlign = "left";
  if (o.text_align !== undefined && o.text_align !== null) {
    const ta = String(o.text_align).trim().toLowerCase();
    if (!(TEXT_ALIGNS as readonly string[]).includes(ta)) {
      return {
        ok: false,
        error: `"text_align" must be one of: ${TEXT_ALIGNS.join(", ")}.`,
      };
    }
    textAlign = ta as TextAlign;
  }

  return {
    ok: true,
    card: {
      name: name.value,
      image: image.value,
      imageCrop,
      type: type.value ?? DEFAULT_TYPE,
      subtype: subtype.value,
      rarity: rarity.value,
      rarityClass: rarityClassOf(rarity.value),
      attunement: attunement.value,
      price: price.value,
      textAlign,
      description: description.value ?? "",
    },
  };
}

export type ImageRef =
  | { kind: "url"; url: string }
  | { kind: "internal"; linkpath: string }
  | { kind: "invalid" };

/**
 * Classify an image value. Only http(s) URLs and Obsidian internal links
 * ([[file.png]], ![[file.png]], [[file.png|alias]], or a bare vault path) are accepted.
 * Anything with another URL scheme (javascript:, data:, file:, ...) is rejected.
 */
export function classifyImage(value: string): ImageRef {
  const v = value.trim();
  const wiki = /^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(v);
  if (wiki) return { kind: "internal", linkpath: wiki[1].trim() };
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return { kind: "url", url: u.href };
      }
    } catch {
      /* fall through */
    }
    return { kind: "invalid" };
  }
  // Any other "scheme:" prefix is refused (javascript:, data:, file:, vbscript:, ...).
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return { kind: "invalid" };
  if (v.includes("..") || v === "") return { kind: "invalid" };
  return { kind: "internal", linkpath: v };
}
