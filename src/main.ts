import {
  Component,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  Notice,
  Plugin,
  parseYaml,
} from "obsidian";
import {
  Card,
  DEFAULT_CROP,
  ImageCrop,
  MAX_ROTATE,
  MAX_ZOOM,
  MIN_ZOOM,
  classifyImage,
  clampZoom,
  dragCrop,
  imageRect,
  parseCard,
  rarityCssSuffix,
} from "./card";
import { setImageCrop } from "./blockEdit";
import { formatDescription, splitDescription } from "./description";

const CODE_BLOCK = "itemcard";
const MAX_SOURCE_LENGTH = 50_000;

const TEMPLATE = [
  "```itemcard",
  "name: Item Name",
  "image: ",
  "type: Wondrous Item",
  "subtype: ",
  "rarity: Rare",
  "attunement: false",
  "price: 500 gp",
  "text_align: left",
  "description: |",
  "  Describe the item here. **Markdown** works,",
  "  and so do line breaks.",
  "",
  "  - Lists",
  "  - Work too",
  "```",
  "",
].join("\n");

export default class FantasyMagicItemCardsPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      CODE_BLOCK,
      (source, el, ctx) => {
        const child = new CardRenderChild(this, el, source, ctx.sourcePath, ctx);
        ctx.addChild(child);
      },
    );

    this.addCommand({
      id: "insert-item-card",
      name: "Insert item card template",
      editorCallback: (editor) => {
        editor.replaceSelection(TEMPLATE);
      },
    });
  }
}

class CardRenderChild extends MarkdownRenderChild {
  // Separate Component so description renders are cleaned up on re-render.
  private descComponent: Component | null = null;

  constructor(
    private plugin: Plugin,
    containerEl: HTMLElement,
    private source: string,
    private sourcePath: string,
    private ctx: MarkdownPostProcessorContext,
  ) {
    super(containerEl);
  }

  onload() {
    this.render();
  }

  onunload() {
    this.descComponent?.unload();
    this.descComponent = null;
  }

  private render() {
    const el = this.containerEl;
    el.empty();

    // Guard against pathological blocks (huge/deeply aliased YAML) freezing the app.
    if (this.source.length > MAX_SOURCE_LENGTH) {
      this.showError(el, `Card block is too large (max ${MAX_SOURCE_LENGTH} characters).`);
      return;
    }

    let raw: unknown;
    try {
      const { yaml, description } = splitDescription(this.source);
      raw = parseYaml(yaml);
      if (description !== undefined && raw && typeof raw === "object" && !Array.isArray(raw)) {
        (raw as Record<string, unknown>).description = description;
      }
    } catch (e) {
      this.showError(el, `Invalid YAML: ${e instanceof Error ? e.message : "parse error"}`);
      return;
    }
    const result = parseCard(raw);
    if (!result.ok) {
      this.showError(el, result.error);
      return;
    }
    this.renderCard(el, result.card);
  }

  private showError(el: HTMLElement, message: string) {
    const box = el.createDiv({ cls: "fmic-error" });
    box.createEl("strong", { text: "Item card error: " });
    box.createSpan({ text: message });
  }

  private renderCard(el: HTMLElement, card: Card) {
    const root = el.createDiv({
      cls: `fmic-card fmic-rarity-${rarityCssSuffix(card.rarityClass)}`,
    });

    // Click the card to see it enlarged. Links, buttons, the image (which has its own
    // viewer) and text selection keep their normal behavior.
    root.addClass("fmic-zoomable");
    const passthrough = "a, button, input, textarea, .fmic-image, .fmic-adjust-bar";
    root.addEventListener("mousedown", (e) => {
      if (!(e.target as HTMLElement).closest(passthrough)) e.stopPropagation();
    });
    root.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(passthrough)) return;
      if (root.win.getSelection()?.toString()) return;
      e.stopPropagation();
      this.openCardViewer(root);
    });

    const header = root.createDiv({ cls: "fmic-header" });
    header.createDiv({ cls: "fmic-name", text: card.name });
    const sub = [card.type, card.subtype].filter(Boolean).join(" · ");
    header.createDiv({ cls: "fmic-type", text: sub });

    if (card.image) this.renderImage(root, card);

    const meta = root.createDiv({ cls: "fmic-meta" });
    if (card.rarity) {
      meta.createSpan({ cls: "fmic-rarity", text: card.rarity });
    }
    if (card.attunement) {
      meta.createSpan({ cls: "fmic-attunement", text: card.attunement });
    }

    if (card.description) {
      const desc = root.createDiv({
        cls: `fmic-description fmic-align-${card.textAlign}`,
      });
      this.descComponent = new Component();
      this.descComponent.load();
      void MarkdownRenderer.render(
        this.plugin.app,
        formatDescription(card.description),
        desc,
        this.sourcePath,
        this.descComponent,
      ).then(() => this.fit(root, desc));
    }

    if (card.price) {
      root.createDiv({ cls: "fmic-price", text: card.price });
    }
  }

  /**
   * Shrink text until the description fits the fixed card size (min 50%).
   *
   * Runs again whenever the card's size changes. That matters for PDF export and
   * printing: the note is rendered in a hidden page where the card has no layout
   * (height 0) at first, so a one-off fit right after render would be skipped.
   * Everything on the card scales together, so a factor measured at screen size
   * also holds at print size.
   */
  private fit(root: HTMLElement, desc: HTMLElement) {
    const win = root.win;
    let frame = 0;
    // Needs a little spare room so rounding differences can't clip the last line. We compare
    // the bottom edge of the last block with the box (scrollHeight can't tell us about spare
    // room: it is never smaller than the box itself).
    const overflows = () => {
      const last = desc.lastElementChild;
      if (!last) return false;
      const limit = desc.getBoundingClientRect().top + desc.clientHeight - 2;
      return last.getBoundingClientRect().bottom > limit || desc.scrollHeight > desc.clientHeight + 1;
    };
    const fitHere = () => {
      let factor = 1;
      root.style.setProperty("--fmic-fit", "1");
      while (overflows() && factor > 0.5) {
        factor = Math.round((factor - 0.05) * 100) / 100;
        root.style.setProperty("--fmic-fit", String(factor));
      }
      return factor;
    };
    const run = () => {
      frame = 0;
      if (!root.isConnected || root.offsetHeight === 0) return;
      // Fit at print size (scale 1) too and take the stricter result, so what fits on screen
      // can't spill over when printed or exported.
      const prevScale = root.style.getPropertyValue("--fmic-scale");
      root.style.setProperty("--fmic-scale", "1");
      const atPrintSize = fitHere();
      if (prevScale) root.style.setProperty("--fmic-scale", prevScale);
      else root.style.removeProperty("--fmic-scale");
      const factor = Math.min(atPrintSize, fitHere());
      root.style.setProperty("--fmic-fit", String(factor));
      root.toggleClass("fmic-overflow", overflows());
    };
    const schedule = () => {
      if (!frame) frame = win.requestAnimationFrame(run);
    };

    schedule();
    const observer = new (win as Window & typeof globalThis).ResizeObserver(schedule);
    observer.observe(root);
    // Re-fit when the content changes height later (tables and other blocks are often
    // finished by the theme or other plugins after our first fit).
    const watchBlocks = () => {
      for (const child of Array.from(desc.children)) observer.observe(child);
    };
    watchBlocks();
    const mutations = new (win as Window & typeof globalThis).MutationObserver(() => {
      watchBlocks();
      schedule();
    });
    mutations.observe(desc, { childList: true, subtree: true, characterData: true });
    // Late-loading fonts/images can change text height without resizing the card.
    const late = win.setTimeout(schedule, 300);
    win.addEventListener("beforeprint", run);
    this.register(() => {
      observer.disconnect();
      mutations.disconnect();
      win.clearTimeout(late);
      win.removeEventListener("beforeprint", run);
      if (frame) win.cancelAnimationFrame(frame);
    });
  }

  private renderImage(root: HTMLElement, card: Card) {
    const ref = classifyImage(card.image ?? "");
    let src: string | null = null;
    if (ref.kind === "url") {
      src = ref.url;
    } else if (ref.kind === "internal") {
      const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
        ref.linkpath,
        this.sourcePath,
      );
      if (file) src = this.plugin.app.vault.getResourcePath(file);
    }
    if (!src) return; // invalid/unresolvable image: silently omit, card still renders

    const frame = root.createDiv({ cls: "fmic-image" });
    const clip = frame.createDiv({ cls: "fmic-image-clip" });
    const attrs = { src, referrerpolicy: "no-referrer" };
    const img = clip.createEl("img", { attr: { ...attrs, alt: card.name } });

    let ratio = 0;
    let saved: ImageCrop = { ...card.imageCrop };
    let current: ImageCrop = { ...saved };
    let ghost: HTMLImageElement | null = null;
    let bar: HTMLElement | null = null;
    let slider: HTMLInputElement | null = null;
    let rotSlider: HTMLInputElement | null = null;
    let adjusting = false;
    let drag: { x: number; y: number; start: ImageCrop } | null = null;

    const place = (el: HTMLElement) => {
      const r = imageRect(ratio, current);
      // Inline !important so theme/Obsidian rules (max-width: 100%, height: auto,
      // etc.) can't clamp the zoomed image back to the frame size.
      const set = (prop: string, value: string) => el.style.setProperty(prop, value, "important");
      set("position", "absolute");
      set("left", `${r.left * 100}%`);
      set("top", `${r.top * 100}%`);
      set("width", `${r.width * 100}%`);
      set("height", `${r.height * 100}%`);
      set("max-width", "none");
      set("max-height", "none");
      set("min-width", "0");
      set("min-height", "0");
      set("margin", "0");
      set("transform", current.rotate ? `rotate(${current.rotate}deg)` : "none");
      set("transform-origin", "50% 50%");
    };
    const apply = () => {
      if (!ratio) return;
      place(img);
      if (ghost) place(ghost);
    };

    img.addEventListener("load", () => {
      ratio = img.naturalWidth / img.naturalHeight;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        frame.remove();
        return;
      }
      apply();
      frame.addClass("fmic-ready");
    });
    img.addEventListener("error", () => frame.remove());

    const exit = () => {
      adjusting = false;
      drag = null;
      frame.removeClass("fmic-adjusting");
      ghost?.remove();
      bar?.remove();
      ghost = bar = slider = rotSlider = null;
      apply();
    };

    const enter = () => {
      if (adjusting || !ratio) return;
      adjusting = true;
      frame.addClass("fmic-adjusting");
      ghost = frame.createEl("img", {
        cls: "fmic-image-ghost",
        attr: { ...attrs, alt: "" },
      });
      frame.insertBefore(ghost, clip);

      bar = frame.createDiv({ cls: "fmic-adjust-bar" });
      bar.createDiv({ cls: "fmic-adjust-hint", text: "Drag the image to move it" });
      const sliderRow = (label: string, min: number, max: number, step: number, value: number) => {
        const row = bar!.createDiv({ cls: "fmic-adjust-row" });
        row.createSpan({ text: label });
        const input = row.createEl("input", {
          attr: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label },
        });
        input.value = String(value);
        return input;
      };
      slider = sliderRow("Zoom", MIN_ZOOM, MAX_ZOOM, 0.01, current.zoom);
      slider.addEventListener("input", () => {
        current.zoom = clampZoom(parseFloat(slider?.value ?? "1"));
        apply();
      });
      // Full circle: 0-360 (360 is stored as 0). Hand-edited negatives show as their equivalent.
      rotSlider = sliderRow("Rotate", 0, MAX_ROTATE, 1, ((current.rotate % 360) + 360) % 360);
      rotSlider.addEventListener("input", () => {
        current.rotate = parseFloat(rotSlider?.value ?? "0") % 360;
        apply();
      });
      const btnRow = bar.createDiv({ cls: "fmic-adjust-row fmic-adjust-buttons" });
      const btn = (text: string, onClick: () => void) => {
        const b = btnRow.createEl("button", { text });
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        return b;
      };
      btn("Reset", () => {
        current = { ...DEFAULT_CROP };
        if (slider) slider.value = String(DEFAULT_CROP.zoom);
        if (rotSlider) rotSlider.value = String(DEFAULT_CROP.rotate);
        apply();
      });
      btn("Cancel", () => {
        current = { ...saved };
        exit();
      });
      btn("Save", () => {
        void this.saveCrop(current).then((ok) => {
          if (ok) saved = { ...current };
          else current = { ...saved };
          exit();
        });
      });
      apply();
    };

    // Keep the editor from grabbing mouse input while adjusting.
    for (const type of ["mousedown", "dblclick"]) {
      frame.addEventListener(type, (e) => e.stopPropagation());
    }
    // Click the image (when not adjusting) to view the whole, uncropped picture.
    frame.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      if (adjusting || !ratio || t.closest(".fmic-adjust-bar, .fmic-adjust-btn")) return;
      this.openViewer(src, card.name);
    });
    frame.addEventListener("pointerdown", (e) => {
      if (!adjusting || (e.target as HTMLElement).closest(".fmic-adjust-bar")) return;
      e.preventDefault();
      e.stopPropagation();
      frame.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, start: { ...current } };
      frame.addClass("fmic-dragging");
    });
    frame.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const rect = frame.getBoundingClientRect();
      current = dragCrop(
        drag.start,
        (e.clientX - drag.x) / rect.width,
        (e.clientY - drag.y) / rect.height,
        ratio,
      );
      apply();
    });
    const endDrag = () => {
      drag = null;
      frame.removeClass("fmic-dragging");
    };
    frame.addEventListener("pointerup", endDrag);
    frame.addEventListener("pointercancel", endDrag);
    frame.addEventListener(
      "wheel",
      (e) => {
        if (!adjusting || (e.target as HTMLElement).closest(".fmic-adjust-bar")) return;
        e.preventDefault();
        e.stopPropagation();
        current.zoom = clampZoom(current.zoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05));
        if (slider) slider.value = String(current.zoom);
        apply();
      },
      { passive: false },
    );

    const adjustBtn = frame.createEl("button", {
      cls: "fmic-adjust-btn",
      text: "Adjust image",
    });
    adjustBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      enter();
    });
  }

  /** Full-size, uncropped view of the image. */
  private openViewer(src: string, alt: string) {
    this.openOverlay((overlay) => {
      const panel = overlay.createDiv({ cls: "fmic-viewer-panel" });
      panel.createEl("img", { attr: { src, alt, referrerpolicy: "no-referrer" } });
      panel.createDiv({ cls: "fmic-viewer-hint", text: "Click or press Esc to close" });
    });
  }

  /** Enlarged copy of the card, sized to fit the window. */
  private openCardViewer(root: HTMLElement) {
    if (root.querySelector(".fmic-adjusting")) return;
    this.openOverlay((overlay) => {
      const win = overlay.ownerDocument.defaultView ?? window;
      const copy = root.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll(".fmic-adjust-btn, .fmic-adjust-bar, .fmic-image-ghost")
        .forEach((n) => n.remove());
      copy.removeClass("fmic-zoomable");
      // The enlarged copy lives outside the note, so a per-note theme font (e.g. ITS cssclasses)
      // wouldn't reach it. Pin the title to the font the original card actually uses.
      const origName = root.querySelector(".fmic-name");
      const copyName = copy.querySelector<HTMLElement>(".fmic-name");
      if (origName && copyName) copyName.style.fontFamily = win.getComputedStyle(origName).fontFamily;
      // 1 in = 96 CSS px, so the card is 240 x 336 px at scale 1.
      const scale = Math.min(5, Math.max(1, Math.min((win.innerHeight * 0.9) / 336, (win.innerWidth * 0.92) / 240)));
      copy.style.setProperty("--fmic-scale", String(scale));
      // `markdown-rendered` keeps Obsidian's content styles for the description outside the note.
      overlay.createDiv({ cls: "markdown-rendered fmic-card-viewer" }).appendChild(copy);
      overlay.createDiv({ cls: "fmic-viewer-hint fmic-viewer-hint-float", text: "Click or press Esc to close" });
    });
  }

  /** Full-window overlay. Click anywhere or press Esc to close. */
  private openOverlay(fill: (overlay: HTMLElement) => void) {
    const doc = this.containerEl.ownerDocument;
    const overlay = doc.body.createDiv({ cls: "fmic-viewer" });
    fill(overlay);

    const close = () => {
      overlay.remove();
      doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    overlay.addEventListener("click", close);
    doc.addEventListener("keydown", onKey, true);
    this.register(close); // also closes if the card is unloaded while open
  }

  /** Write the crop into the note's code block. Returns false (with a notice) on failure. */
  private async saveCrop(crop: ImageCrop): Promise<boolean> {
    try {
      const info = this.ctx.getSectionInfo(this.containerEl);
      const file = this.plugin.app.vault.getFileByPath(this.sourcePath);
      if (!info || !file) throw new Error("Can't locate this card in its note.");

      await this.plugin.app.vault.process(file, (data) => {
        const eol = data.includes("\r\n") ? "\r\n" : "\n";
        const lines = data.split(eol);
        const open = lines[info.lineStart];
        const close = lines[info.lineEnd];
        if (
          open === undefined ||
          close === undefined ||
          !/^(```|~~~)\s*itemcard\b/.test(open) ||
          !/^(```|~~~)\s*$/.test(close)
        ) {
          throw new Error(
            "Couldn't find this card's code block (cards inside callouts or lists can't be adjusted yet). Edit image_pos/image_zoom by hand.",
          );
        }
        const body = lines.slice(info.lineStart + 1, info.lineEnd).join("\n");
        const norm = (s: string) => s.replace(/\r\n?/g, "\n").trimEnd();
        if (norm(body) !== norm(this.source)) {
          throw new Error("The note changed since this card was rendered. Nothing was saved; try again.");
        }
        const updated = setImageCrop(body, crop).split("\n");
        lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...updated);
        return lines.join(eol);
      });
      return true;
    } catch (e) {
      new Notice(e instanceof Error ? e.message : "Couldn't save the image position.");
      return false;
    }
  }
}
