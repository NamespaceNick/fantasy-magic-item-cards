// Preprocess a card description so newlines behave the way people expect,
// before handing it to Obsidian's Markdown renderer.
//
// Standard Markdown collapses a single newline inside a paragraph into a space.
// For card text that's surprising, so we turn single newlines between ordinary
// prose lines into hard line breaks, while leaving block structure alone
// (blank-line paragraphs, lists, tables, headings, quotes, code fences, rules).

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

function isStructural(line: string): boolean {
  return TABLE_ROW.test(line) || HEADING.test(line) || HR.test(line) || FENCE.test(line);
}

const OTHER_KEYS = [
  "name", "title_en", "image", "image_pos", "image_zoom", "image_rotate", "type", "subtype",
  "rarity", "attunement", "price", "text_align",
];
const NEXT_KEY = new RegExp(`^(${OTHER_KEYS.join("|")})\\s*:`);

/**
 * Pull the `description` field out of the raw card source as literal text so
 * YAML can't fold its newlines into spaces. Everything after `description:`
 * (until the next known field at column 0) is the description. A one-line
 * value is left in the YAML so quoting keeps working.
 */
export function splitDescription(source: string): { yaml: string; description?: string } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^description\s*:/.test(l));
  if (idx === -1) return { yaml: source };

  let end = idx + 1;
  while (end < lines.length && !NEXT_KEY.test(lines[end])) end++;

  let first = lines[idx].replace(/^description\s*:\s*/, "");
  if (/^[|>][+-]?\d*\s*$/.test(first)) first = "";
  const rest = lines.slice(idx + 1, end);
  if (first !== "" && rest.every((l) => l.trim() === "")) return { yaml: source };

  const indents = rest
    .filter((l) => l.trim() !== "")
    .map((l) => /^[ \t]*/.exec(l)![0].length);
  const dedent = indents.length ? Math.min(...indents) : 0;
  const body = [...(first ? [first] : []), ...rest.map((l) => l.slice(Math.min(dedent, /^[ \t]*/.exec(l)![0].length)))];

  return {
    yaml: [...lines.slice(0, idx), ...lines.slice(end)].join("\n"),
    description: body.join("\n"),
  };
}

export function formatDescription(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const next = lines[i + 1];
    const wantsBreak =
      next !== undefined &&
      line.trim() !== "" &&
      next.trim() !== "" &&
      !isStructural(line) &&
      !isStructural(next) &&
      !FENCE.test(next);

    line = line.replace(/[ \t]+$/, "");
    if (wantsBreak && !line.endsWith("\\")) line += "  ";
    out.push(line);
  }
  return out.join("\n");
}
