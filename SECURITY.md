# Security policy

## Reporting a vulnerability

Please report security issues privately using GitHub's
[private vulnerability reporting](https://github.com/NamespaceNick/fantasy-magic-item-cards/security/advisories/new)
rather than opening a public issue. I'll respond as soon as I can.

## What this plugin does and doesn't do

- Renders cards from `itemcard` code blocks in your notes.
- Makes **no network requests of its own**. If a card's `image` is an `http(s)` URL, your
  Obsidian app loads that image like any embedded image would.
- Only accepts `http(s)` URLs and vault files for images. Other schemes (`javascript:`, `data:`,
  `file:`) are refused.
- Builds the card with DOM APIs (no `innerHTML`). Descriptions go through Obsidian's own
  Markdown renderer.
- The only time it writes to your notes is when you press **Save** in *Adjust image*; it then edits
  that card's `image_pos` / `image_zoom` / `image_rotate` lines and nothing else.
- No telemetry, no `eval`, no external code loaded at runtime.
