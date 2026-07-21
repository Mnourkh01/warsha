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

import { ptySpawn, ptyWrite, ptyResize, ptyKill } from "../../lib/ipc";
import type { ShellKind } from "../../lib/types";
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
  /** A command auto-run once after the shell starts (e.g. launch an AI CLI). */
  initCommand?: string;
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
  private ro?: ResizeObserver;
  private onExitCb?: () => void;

  constructor(sessionId: string, opts: TerminalOpts) {
    this.sessionId = sessionId;
    this.opts = opts;

    this.el = document.createElement("div");
    this.el.className = "term-host";

    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, "Cascadia Code", monospace',
      fontSize: opts.fontSize,
      fontWeight: opts.bold ? 600 : 400,
      fontWeightBold: opts.bold ? 700 : 700,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 8000,
      theme: terminalThemeFor(opts.theme, opts.foreground),
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new WebLinksAddon());
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";

    this.term.onData((data) => {
      void ptyWrite(this.sessionId, data);
    });

    // Ctrl+C is SIGINT in a shell, so copy/paste use Ctrl+Shift+C / Ctrl+Shift+V.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
        const sel = this.term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
        void navigator.clipboard.readText().then((t) => {
          if (t) void ptyWrite(this.sessionId, t);
        });
        return false;
      }
      return true;
    });
  }

  /** Move the terminal element into a pane container and ensure it is running. */
  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
    if (!this.opened) {
      this.term.open(this.el);
      this.tryWebgl();
      this.opened = true;
      this.ro = new ResizeObserver(() => this.fitAndMaybeSpawn());
      this.ro.observe(this.el);
    }
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

  /** Detach the element (keeps the instance + PTY alive). */
  detach(): void {
    if (this.el.parentElement) this.el.parentElement.removeChild(this.el);
  }

  focus(): void {
    this.term.focus();
  }

  setExitHandler(cb: () => void): void {
    this.onExitCb = cb;
  }

  /** Called when the backend reports the process exited. */
  notifyExit(): void {
    this.term.write("\r\n\x1b[38;5;244m[process exited]\x1b[0m\r\n");
    this.onExitCb?.();
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

  search(term: string): void {
    this.searchAddon.findNext(term);
  }

  private tryWebgl(): void {
    if (webglCount >= MAX_WEBGL) return;
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
    if (this.term.cols > 0 && this.term.rows > 0) {
      if (!this.spawned) {
        this.spawn(this.term.cols, this.term.rows);
      } else {
        void ptyResize(this.sessionId, this.term.cols, this.term.rows);
      }
    }
  }

  private spawn(cols: number, rows: number): void {
    this.spawned = true;
    ptySpawn(
      { id: this.sessionId, shell: this.opts.shell, cwd: this.opts.cwd, cols, rows },
      (bytes) => this.term.write(bytes),
    )
      .then(() => {
        // Auto-run a launch command (e.g. `claude`) once the shell has its first prompt.
        const cmd = this.opts.initCommand;
        if (cmd) {
          setTimeout(() => void ptyWrite(this.sessionId, `${cmd}\r`), 600);
        }
      })
      .catch((err) => {
        this.term.write(`\r\n\x1b[38;5;203mFailed to start shell: ${String(err)}\x1b[0m\r\n`);
      });
  }

  dispose(): void {
    this.ro?.disconnect();
    if (this.webgl) {
      this.webgl.dispose();
      this.webgl = undefined;
      webglCount = Math.max(0, webglCount - 1);
    }
    void ptyKill(this.sessionId);
    this.term.dispose();
    this.detach();
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

export function hasTerminal(sessionId: string): boolean {
  return registry.has(sessionId);
}

export function disposeTerminal(sessionId: string): void {
  const c = registry.get(sessionId);
  if (c) {
    c.dispose();
    registry.delete(sessionId);
  }
}

export function applySettingsToAll(opts: Partial<TerminalOpts>): void {
  for (const c of registry.values()) c.applySettings(opts);
}

export type { TerminalController };
