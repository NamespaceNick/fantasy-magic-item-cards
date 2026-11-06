# Fantasy Magic Item Cards

An [Obsidian](https://obsidian.md) plugin that renders fantasy (D&D-style) magic item cards from a
simple code block. Cards are poker-card sized (2.5 × 3.5 in), so they print at true size.

Inspired by [wonderful-cards](https://github.com/trikorka/wonderful-cards). English only, with
full Markdown descriptions and an interactive image cropper.

## Usage

Insert a template with the command palette: **Insert item card template**. Or write one yourself:

````
```itemcard
name: Staff of Power
type: Staff
rarity: Very Rare
attunement: by a sorcerer, warlock, or wizard
price: 12000
image: staff.png
text_align: left
description: |
  A **magic quarterstaff** with a +2 bonus to attack and damage rolls.
  Line breaks are kept as written.

  - Lists work
  - So do *italics*, tables and links
```
````

### Fields

| Field | Notes |
| --- | --- |
| `name` | **Required.** |
| `type` | Defaults to `Wondrous Item`. |
| `subtype` | Optional, shown after the type. |
| `rarity` | Common, Uncommon, Rare, Very Rare, Legendary, Artifact (sets the accent color). Other text is shown with a neutral color. |
| `attunement` | `true`, or text such as `by a wizard`. |
| `price` | A bare number becomes `N gp`; or write `20 sp`, `5 cp`. |
| `image` | `http(s)` URL, a vault file (`art.png` or `![[art.png]]`). Transparent PNGs blend into the card. |
| `image_pos`, `image_zoom`, `image_rotate` | Set by **Adjust image** (below); you can edit by hand. |
| `text_align` | `left`, `center`, `right`, `justify`. |
| `description` | Markdown. Everything after `description:` is taken as the description, so put it **last**. Every line break is preserved. |

### Adjusting the image

Hover a card and click **Adjust image**. Drag to move, zoom with the slider or mouse wheel
(below 1 shrinks the picture with transparent space around it), rotate 0–360°, then **Save**.
The values are written into the card's code block. Click an image any time to see the full
original.

Cards inside callouts or lists can't be saved from the UI; edit the fields by hand there.

### Printing

Print or export to PDF at **100% scale** with normal margins. Cards print at exactly
2.5 × 3.5 in. Long descriptions shrink to fit; if one still doesn't fit, the card gets a dashed
red outline on screen (not in print) — shorten the text.

### Privacy note

If a card's `image` is an `http(s)` URL, Obsidian loads it from that server whenever the note is
shown, so the server can see your IP address. The plugin sends no referrer and makes no other
network requests. Prefer images stored in your vault, especially for notes you didn't write
yourself.

## Install

**With BRAT (before it's in the community list):**
1. Install the *BRAT* community plugin.
2. *Add beta plugin* → `NamespaceNick/fantasy-magic-item-cards`.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the latest release into
`<vault>/.obsidian/plugins/fantasy-magic-item-cards/`, then enable the plugin.

## Development

```
npm install
npm run dev      # watch + rebuild main.js
npm test
npm run build    # typecheck + production bundle
```

Symlink/junction the project folder into a **test vault's** `.obsidian/plugins/` and use the
Hot Reload plugin for fast iteration. See `SECURITY.md` for the security model.

## License

MIT
