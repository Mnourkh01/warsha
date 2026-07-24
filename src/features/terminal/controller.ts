// One long-lived xterm instance per session, kept in a registry so it survives React
// remounts and pane moves. The controller owns its own host element which we re-parent
// into whichever pane is showing the session; when no pane shows it, the element is
// detached but the PTY + buffer stay alive (cheap suspend).

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";

import {
  ptySpawn,
  ptyWrite,
  ptyResize,
  ptyKill,
  openExternal,
  clipboardReadText,
  clipboardWriteText,
} from "../../lib/ipc";
import type { ShellKind } from "../../lib/types";
import { useRuntime } from "../../store/runtime";
import { dropTracking, noteOutput } from "./attention";
import { shapeArabicVisual } from "./arabicGlyphs";
import { ExtraLinksProvider } from "./links";
import { terminalBg, terminalThemeFor } from "./theme";

export interface TerminalOpts {
  shell: ShellKind;
  cwd?: string;
  fontSize: number;
  theme: "dark" | "light";
  /** Optional terminal text-color override (empty = use the theme foreground). */
  foreground?: string;
  /** Render terminal text at a heavier weight. */
  bold?: boolean;
}

// Browsers cap live WebGL contexts (~16/process). Stay well under with a soft budget;
// terminals past the budget use the (still fine) DOM renderer.
const MAX_WEBGL = 8;
let webglCount = 0;

class TerminalController {
  readonly sessionId: string;
  readonly el: HTMLDivElement;
  private term: Terminal;
  private fitAddon: FitAddon;
  private searchAddon: SearchAddon;
  private webgl?: WebglAddon;
  private opts: TerminalOpts;
  private opened = false;
  private spawned = false;
  private spawnFailed = false;
  private disposed = false;
  /** In-flight ptySpawn, settle-safe. dispose() awaits it so the kill can never race a
   *  spawn that has not registered in Rust yet (which would orphan a live ConPTY). */
  private spawnSettled: Promise<void> | null = null;
  private ro?: ResizeObserver;
  private lastCols = 0;
  private lastRows = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastQueueFullNotice = 0;
  // Streaming decoder so a multibyte UTF-8 sequence split across two PTY chunks still
  // decodes correctly (state carries between decode(bytes, {stream: true}) calls).
  private decoder = new TextDecoder();

  constructor(sessionId: string, opts: TerminalOpts) {
    this.sessionId = sessionId;
    this.opts = opts;

    this.el = document.createElement("div");
    this.el.className = "term-host";

    this.term = new Terminal({
      allowProposedApi: true,
      // "Courier New" is the deterministic fallback for Arabic Presentation Forms
      // (U+FE70-FEFF, produced by shapeArabicVisual): it ships with Windows, includes the
      // full range, and stays metric-stable inside the monospace grid.
      fontFamily: '"IBM Plex Mono", ui-monospace, "Cascadia Code", "Courier New", monospace',
      fontSize: opts.fontSize,
      fontWeight: opts.bold ? 600 : 400,
      fontWeightBold: opts.bold ? 700 : 700,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 8000,
      theme: terminalThemeFor(opts.theme, opts.foreground),
      // OSC 8 hyperlinks (modern CLIs, incl. Claude Code, emit these). Same untrusted-
      // output rule as WebLinksAddon below: only http(s) leaves the app, system browser.
      linkHandler: {
        activate: (_event, uri) => {
          void openExternal(uri);
        },
      },
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    // Terminal output is untrusted (any remote program can print a link), so clicks
    // must open the SYSTEM browser via the opener plugin, never a WebView window.
    this.term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openExternal(uri);
      }),
    );
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";
    // Bare www. domains + Windows paths (revealed in Explorer, never executed).
    this.term.registerLinkProvider(new ExtraLinksProvider(this.term));

    this.term.onData((data) => {
      // Dead-session rejections stay silent (the exit notice is already printed), but a
      // FULL input queue means a stalled child is eating keystrokes; say so, throttled.
      void ptyWrite(this.sessionId, data).catch((err: unknown) => {
        if (!String(err).startsWith("queue_full:")) return;
        const now = Date.now();
        if (now - this.lastQueueFullNotice < 2000) return;
        this.lastQueueFullNotice = now;
        this.term.write(
          "\r\n\x1b[33m[warsha] session is not accepting input, the program looks stuck\x1b[0m\r\n",
        );
      });
    });

    // Ctrl+C stays SIGINT; copy is Ctrl+Shift+C / Ctrl+Insert. Paste is Ctrl+V (Windows
    // Terminal parity), Ctrl+Shift+V, and Shift+Insert. Clipboard I/O goes through the
    // Rust plugin (clipboardReadText/WriteText), not navigator.clipboard - WebView2
    // blocks clipboard READ from the WebView, which is why paste silently did nothing
    // before. When Ctrl+V finds NO text (e.g. the clipboard holds an image), the ^V byte
    // is forwarded to the PTY instead so a TUI like Claude Code can grab the image
    // itself. Apps that want a literal ^V with text on the clipboard use Ctrl+Q (readline
    // quoted-insert), same tradeoff as Windows Terminal.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const copy =
        (e.ctrlKey && e.shiftKey && e.code === "KeyC") || (e.ctrlKey && e.code === "Insert");
      const paste =
        (e.ctrlKey && !e.altKey && e.code === "KeyV") || (e.shiftKey && e.code === "Insert");
      if (copy) {
        this.copySelection();
        return false;
      }
      if (paste) {
        this.pasteClipboard(e.ctrlKey && !e.shiftKey);
        return false;
      }
      return true;
    });

    // Right-click follows the Windows console convention: copy when there is a selection,
    // otherwise paste. Gives mouse-only users a full copy/paste path.
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.term.hasSelection()) {
        this.copySelection();
        this.term.clearSelection();
      } else {
        this.pasteClipboard();
      }
    });
  }

  private copySelection(): void {
    const sel = this.term.getSelection();
    if (sel) void clipboardWriteText(sel).catch((err) => console.warn("clipboard copy failed", err));
  }

  /** Paste clipboard text; with `forwardWhenEmpty`, a text-less clipboard (image, files)
   *  sends a literal ^V to the PTY so the running TUI can read the clipboard itself. */
  private pasteClipboard(forwardWhenEmpty = false): void {
    const forward = () => {
      if (!this.disposed) void ptyWrite(this.sessionId, "\x16").catch(() => {});
    };
    void clipboardReadText()
      .then((t) => {
        if (this.disposed) return;
        // paste() honors bracketed-paste (mode 2004) when the app enabled it, so a
        // multi-line snippet does not execute line-by-line in vim/REPLs.
        if (t) this.term.paste(t);
        else if (forwardWhenEmpty) forward();
      })
      .catch((err) => {
        // The keystroke must never be swallowed outright: fall through to the PTY.
        console.warn("clipboard paste failed", err);
        if (forwardWhenEmpty) forward();
      });
  }

  /** Move the terminal element into a pane container and ensure it is running. */
  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
    if (!this.opened) {
      this.term.open(this.el);
      this.opened = true;
      this.ro = new ResizeObserver(() => this.fitAndMaybeSpawn());
      this.ro.observe(this.el);
    }
    // (Re)acquire a WebGL context while visible; detach() released it, so the browser's
    // ~16-context budget always goes to panes the user can actually see.
    this.tryWebgl();
    this.paintBg();
    this.fitAndMaybeSpawn();
  }

  // xterm (with the WebGL renderer) leaves the viewport DOM background at the CSS default
  // (black), so any area the canvas doesn't cover shows black. Paint it from the theme.
  private paintBg(): void {
    const color = terminalBg(this.opts.theme);
    this.el.style.background = color;
    const vp = this.el.querySelector(".xterm-viewport") as HTMLElement | null;
    if (vp) vp.style.backgroundColor = color;
    const screen = this.el.querySelector(".xterm-screen") as HTMLElement | null;
    if (screen) screen.style.backgroundColor = color;
  }

  /** Detach the element (keeps the instance + PTY alive). Hidden panes give up their
   *  WebGL context (xterm falls back to the DOM renderer) - see attach(). */
  detach(): void {
    this.releaseWebgl();
    if (this.el.parentElement) this.el.parentElement.removeChild(this.el);
  }

  focus(): void {
    this.term.focus();
  }

  /** Re-measure the grid (font metrics changed, e.g. a devicePixelRatio switch). */
  refit(): void {
    if (this.opened && !this.disposed) this.fitAndMaybeSpawn();
  }

  /** Called when the backend reports the process exited. */
  notifyExit(code?: number): void {
    const suffix = code ? ` (code ${code})` : "";
    this.term.write(`\r\n\x1b[38;5;244m[process exited${suffix}]\x1b[0m\r\n`);
  }

  applySettings(opts: Partial<TerminalOpts>): void {
    this.opts = { ...this.opts, ...opts };
    if (opts.fontSize !== undefined) this.term.options.fontSize = opts.fontSize;
    if (opts.bold !== undefined) this.term.options.fontWeight = opts.bold ? 600 : 400;
    // Always recompute from the merged opts so clearing the color override also works.
    this.term.options.theme = terminalThemeFor(this.opts.theme, this.opts.foreground);
    this.paintBg();
    this.fit();
  }

  searchNext(term: string, incremental = false): void {
    if (term) this.searchAddon.findNext(term, { incremental });
  }

  searchPrev(term: string): void {
    if (term) this.searchAddon.findPrevious(term);
  }

  clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  private releaseWebgl(): void {
    if (this.webgl) {
      this.webgl.dispose();
      this.webgl = undefined;
      webglCount = Math.max(0, webglCount - 1);
    }
  }

  private tryWebgl(): void {
    if (this.webgl || !this.opened || webglCount >= MAX_WEBGL) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        this.webgl = undefined;
        webglCount = Math.max(0, webglCount - 1);
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
      webglCount += 1;
    } catch {
      // No WebGL - the DOM renderer is used automatically. Not an error.
    }
  }

  private fit(): void {
    try {
      this.fitAddon.fit();
    } catch {
      /* element not laid out yet */
    }
  }

  private fitAndMaybeSpawn(): void {
    this.fit();
    const { cols, rows } = this.term;
    if (cols <= 0 || rows <= 0) return;
    if (!this.spawned) {
      this.lastCols = cols;
      this.lastRows = rows;
      this.spawn(cols, rows);
      return;
    }
    if (this.spawnFailed || this.disposed) return;
    // Only tell the PTY when the GRID actually changed, and coalesce the storm a
    // separator drag produces (ResizeObserver fires per frame; each ConPTY resize
    // forces alt-screen TUIs to fully repaint).
    if (cols === this.lastCols && rows === this.lastRows) return;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.disposed) return;
      const c = this.term.cols;
      const r = this.term.rows;
      if (c === this.lastCols && r === this.lastRows) return;
      this.lastCols = c;
      this.lastRows = r;
      void ptyResize(this.sessionId, c, r).catch((err) => {
        console.debug(`resize dropped for ${this.sessionId}`, err);
      });
    }, 60);
  }

  private spawn(cols: number, rows: number): void {
    this.spawned = true;
    const inflight = ptySpawn(
      { id: this.sessionId, shell: this.opts.shell, cwd: this.opts.cwd, cols, rows },
      (bytes) => {
        // Guard: in-flight Channel bytes can arrive after dispose (xterm throws on a
        // disposed Terminal, and the throw happens inside the channel callback).
        if (!this.disposed) {
          // Decode ourselves (instead of letting xterm do it) so Arabic can be shaped:
          // base letters become contextual presentation forms, 1:1, and render connected
          // under any renderer. Pure ASCII chunks pass through shapeArabicVisual untouched.
          this.term.write(shapeArabicVisual(this.decoder.decode(bytes, { stream: true })));
          noteOutput(this.sessionId, bytes.length);
        }
      },
    );
    this.spawnSettled = inflight.then(
      () => undefined,
      () => undefined,
    );
    inflight
      .then(() => {
        if (this.disposed) return;
        // The grid may have changed while the spawn was in flight; those resizes hit a
        // not-yet-registered id and were dropped. Re-sync once the PTY exists.
        const c = this.term.cols;
        const r = this.term.rows;
        if (c !== cols || r !== rows) {
          this.lastCols = c;
          this.lastRows = r;
          void ptyResize(this.sessionId, c, r).catch((err) => {
            console.debug(`post-spawn resize failed for ${this.sessionId}`, err);
          });
        }
      })
      .catch((err) => {
        // Spawn failed: mark it so resize traffic stops, and correct the status dot
        // (newSession optimistically set it to "running"). A DISPOSED controller must
        // not touch the runtime store - the session is gone and a write here would
        // resurrect its key as a permanent zombie entry.
        this.spawnFailed = true;
        if (!this.disposed) {
          useRuntime.getState().setStatus(this.sessionId, "exited");
          this.term.write(`\r\n\x1b[38;5;203mFailed to start shell: ${String(err)}\x1b[0m\r\n`);
        }
      });
  }

  /** Tear down the terminal + PTY. Resolves once the backend kill has been processed,
   *  so callers can safely respawn under the same session id. The kill waits for any
   *  in-flight spawn to settle first: killing before the Rust side registered the
   *  session was a no-op that left the new ConPTY alive and the id poisoned. */
  dispose(): Promise<void> {
    this.disposed = true;
    dropTracking(this.sessionId);
    this.ro?.disconnect();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.releaseWebgl();
    const killed = (this.spawnSettled ?? Promise.resolve())
      .then(() => ptyKill(this.sessionId))
      .catch(() => {});
    this.term.dispose();
    this.detach();
    return killed;
  }
}

// ---- registry -------------------------------------------------------------

const registry = new Map<string, TerminalController>();

export function ensureTerminal(sessionId: string, opts: TerminalOpts): TerminalController {
  let c = registry.get(sessionId);
  if (!c) {
    c = new TerminalController(sessionId, opts);
    registry.set(sessionId, c);
  }
  return c;
}

export function getTerminal(sessionId: string): TerminalController | undefined {
  return registry.get(sessionId);
}

export function disposeTerminal(sessionId: string): Promise<void> {
  const c = registry.get(sessionId);
  if (!c) return Promise.resolve();
  registry.delete(sessionId);
  return c.dispose();
}

export function applySettingsToAll(opts: Partial<TerminalOpts>): void {
  for (const c of registry.values()) c.applySettings(opts);
}

// devicePixelRatio switch (window dragged to a monitor with different scaling): xterm's
// WebGL addon rebuilds its glyph atlas itself, but cell CSS size can shift by rounding
// while the element size stays constant, so ResizeObserver never fires - re-fit all
// terminals explicitly. The matchMedia must be re-armed after every change because the
// query string embeds the ratio it was created at.
function armDprListener(): void {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener(
    "change",
    () => {
      for (const c of registry.values()) c.refit();
      armDprListener();
    },
    { once: true },
  );
}
// Module also loads in non-browser contexts (vitest); the listener only makes sense
// with a real window.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  armDprListener();
}

export type { TerminalController };
