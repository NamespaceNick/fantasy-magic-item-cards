import { describe, expect, it } from "vitest";
import { classifyImage, formatPrice, parseCard, rarityClassOf } from "./card";
import { formatDescription, splitDescription } from "./description";
import { dragCrop, imageRect, FRAME_ASPECT } from "./card";
import { setImageCrop } from "./blockEdit";

describe("image crop math", () => {
  it("covers the frame at zoom 1 for wide and tall images", () => {
    const wide = imageRect(FRAME_ASPECT * 2, { x: 0.5, y: 0.5, zoom: 1, rotate: 0 });
    expect(wide.height).toBeCloseTo(1);
    expect(wide.width).toBeCloseTo(2);
    expect(wide.left).toBeCloseTo(-0.5);
    const tall = imageRect(FRAME_ASPECT / 2, { x: 0, y: 1, zoom: 1, rotate: 0 });
    expect(tall.width).toBeCloseTo(1);
    expect(tall.top).toBeCloseTo(-1); // bottom-aligned
  });
  it("dragging right reveals more of the left side and clamps", () => {
    const start = { x: 0.5, y: 0.5, zoom: 1, rotate: 0 };
    const r = FRAME_ASPECT * 2; // width 2x frame => 1x overflow
    expect(dragCrop(start, 0.25, 0, r).x).toBeCloseTo(0.25);
    expect(dragCrop(start, 5, 0, r).x).toBe(0);
    expect(dragCrop(start, -5, 0, r).x).toBe(1);
    expect(dragCrop(start, 0, 0.3, r).y).toBe(0.5); // no vertical overflow at zoom 1
  });
});

describe("crop fields", () => {
  it("parses image_pos and image_zoom", () => {
    const r = parseCard({ name: "x", image_pos: "40% 25%", image_zoom: 1.5 });
    expect(r.ok && r.card.imageCrop).toEqual({ x: 0.4, y: 0.25, zoom: 1.5, rotate: 0 });
  });
  it("rejects invalid values", () => {
    expect(parseCard({ name: "x", image_pos: "abc" }).ok).toBe(false);
    expect(parseCard({ name: "x", image_pos: "50%" }).ok).toBe(false);
    expect(parseCard({ name: "x", image_pos: "150% 0%" }).ok).toBe(false);
    expect(parseCard({ name: "x", image_zoom: 9 }).ok).toBe(false);
    expect(parseCard({ name: "x", image_zoom: 0.05 }).ok).toBe(false);
    expect(parseCard({ name: "x", image_rotate: 500 }).ok).toBe(false);
    expect(parseCard({ name: "x", image_rotate: "spin" }).ok).toBe(false);
  });
  it("allows zooming out below 1 and rotating", () => {
    const r = parseCard({ name: "x", image_zoom: 0.4, image_rotate: -35 });
    expect(r.ok && r.card.imageCrop).toEqual({ x: 0.5, y: 0.5, zoom: 0.4, rotate: -35 });
  });
  it("keeps a zoomed-out image inside the frame and draggable", () => {
    const r = imageRect(1.0, { x: 0.5, y: 0.5, zoom: 0.4, rotate: 0 });
    expect(r.height).toBeLessThan(1);
    expect(r.top).toBeGreaterThanOrEqual(0);
    const start = { x: 0.5, y: 0.5, zoom: 0.4, rotate: 0 };
    expect(dragCrop(start, 0.1, 0, 1.0).x).toBeGreaterThan(0.5); // smaller than frame: moves with the cursor
    expect(dragCrop(start, 9, 0, 1.0).x).toBe(1);
  });
  it("writes and resets rotation", () => {
    const base = "name: X\nimage: a.png\ndescription: hi";
    const out = setImageCrop(base, { x: 0.5, y: 0.5, zoom: 0.4, rotate: -35 });
    expect(out).toBe("name: X\nimage: a.png\nimage_zoom: 0.4\nimage_rotate: -35\ndescription: hi");
    expect(setImageCrop(out, { x: 0.5, y: 0.5, zoom: 1, rotate: 0 })).toBe(base);
  });
});

describe("setImageCrop", () => {
  const src = "name: X\nimage: ![[a.png]]\nprice: 5\ndescription: |\n  image_pos: not a field\n  text";
  it("inserts after image and keeps description text intact", () => {
    const out = setImageCrop(src, { x: 0.421, y: 0.18, zoom: 1.3, rotate: 0 });
    expect(out).toBe(
      "name: X\nimage: ![[a.png]]\nimage_pos: 42% 18%\nimage_zoom: 1.3\nprice: 5\ndescription: |\n  image_pos: not a field\n  text",
    );
  });
  it("replaces existing fields and removes them on reset", () => {
    const once = setImageCrop(src, { x: 0.1, y: 0.2, zoom: 2, rotate: 0 });
    const twice = setImageCrop(once, { x: 0.9, y: 0.9, zoom: 2, rotate: 0 });
    expect(twice.match(/image_pos/g)!.length).toBe(2); // 1 real + 1 in description text
    expect(setImageCrop(once, { x: 0.5, y: 0.5, zoom: 1, rotate: 0 })).toBe(src);
  });
  it("round-trips through splitDescription and parseCard", () => {
    const out = setImageCrop(src, { x: 0.3, y: 0.7, zoom: 1.5, rotate: 0 });
    const { yaml, description } = splitDescription(out);
    expect(description).toBe("image_pos: not a field\ntext");
    expect(yaml).toContain("image_pos: 30% 70%");
  });
});

describe("splitDescription", () => {
  it("keeps newlines for plain multi-line values that YAML would fold", () => {
    const r = splitDescription("name: X\ndescription: line one\n  line two\n  line three\nprice: 5");
    expect(r.description).toBe("line one\nline two\nline three");
    expect(r.yaml).toBe("name: X\nprice: 5");
  });
  it("handles | and > indicators and nested indentation", () => {
    expect(splitDescription("name: X\ndescription: >\n  a\n  b\n    - c").description).toBe("a\nb\n  - c");
    expect(splitDescription("name: X\ndescription: |\n  a\n\n  b").description).toBe("a\n\nb");
  });
  it("leaves one-line values to YAML", () => {
    expect(splitDescription('name: X\ndescription: "hi: there"').description).toBeUndefined();
  });
  it("does not stop at colons in prose", () => {
    expect(splitDescription("description: |\n  Spells: fireball\n  Note: x").description).toBe("Spells: fireball\nNote: x");
  });
});

describe("parseCard", () => {
  it("requires a name", () => {
    expect(parseCard({}).ok).toBe(false);
    expect(parseCard(null).ok).toBe(false);
    expect(parseCard("x").ok).toBe(false);
  });

  it("applies defaults", () => {
    const r = parseCard({ name: "Staff of Power" });
    expect(r.ok && r.card.type).toBe("Wondrous Item");
    expect(r.ok && r.card.textAlign).toBe("left");
    expect(r.ok && r.card.rarityClass).toBe("unknown");
  });

  it("maps attunement", () => {
    const a = (v: unknown) => {
      const r = parseCard({ name: "x", attunement: v });
      return r.ok ? r.card.attunement : r.error;
    };
    expect(a(true)).toBe("Requires attunement");
    expect(a(false)).toBeUndefined();
    expect(a("by a wizard")).toBe("Requires attunement by a wizard");
    expect(a("Requires attunement by a cleric")).toBe("Requires attunement by a cleric");
  });

  it("rejects bad text_align and oversized fields", () => {
    expect(parseCard({ name: "x", text_align: "evil; x: y" }).ok).toBe(false);
    expect(parseCard({ name: "x".repeat(201) }).ok).toBe(false);
    expect(parseCard({ name: { a: 1 } }).ok).toBe(false);
  });

  it("never lets raw rarity text into the css class", () => {
    const r = parseCard({ name: "x", rarity: 'rare" onload="x' });
    expect(r.ok && r.card.rarityClass).toBe("unknown");
    expect(rarityClassOf("Very Rare")).toBe("very rare");
    expect(rarityClassOf("very_rare")).toBe("very rare");
  });
});

describe("formatPrice", () => {
  it("adds gp to bare numbers only", () => {
    expect(formatPrice(500).value).toBe("500 gp");
    expect(formatPrice("1,500").value).toBe("1,500 gp");
    expect(formatPrice("20 sp").value).toBe("20 sp");
  });
});

describe("classifyImage", () => {
  it("accepts http(s) and internal links", () => {
    expect(classifyImage("https://x.com/a.png").kind).toBe("url");
    expect(classifyImage("![[a.png]]")).toEqual({ kind: "internal", linkpath: "a.png" });
    expect(classifyImage("[[img/a.png|alias]]")).toEqual({ kind: "internal", linkpath: "img/a.png" });
    expect(classifyImage("img/a.png").kind).toBe("internal");
  });

  it("rejects dangerous schemes and traversal", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "file:///C:/Windows/win.ini",
      "vbscript:x",
      "../../secret.png",
      "",
    ]) {
      expect(classifyImage(bad).kind).toBe("invalid");
    }
  });
});

describe("formatDescription", () => {
  it("turns single newlines in prose into hard breaks", () => {
    expect(formatDescription("line one\nline two")).toBe("line one  \nline two");
  });

  it("keeps blank-line paragraphs untouched", () => {
    expect(formatDescription("a\n\nb")).toBe("a\n\nb");
  });

  it("does not break around tables, headings or code fences", () => {
    const md = "intro\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\nmore\n```";
    const out = formatDescription(md);
    expect(out).toContain("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("code\nmore");
    expect(out.split("\n")[0]).toBe("intro");
  });

  it("normalizes CRLF and trims", () => {
    expect(formatDescription("\r\na\r\nb\r\n\r\n")).toBe("a  \nb");
  });

  it("does not double up an explicit backslash break", () => {
    expect(formatDescription("a\\\nb")).toBe("a\\\nb");
  });
});
