// Extra link detection beyond WebLinksAddon (which only linkifies absolute http(s) URLs
// in plain text): bare `www.` domains open as https, and absolute Windows paths are
// revealed in Explorer. Terminal output is untrusted, so a path is NEVER launched with
// its default handler (that could execute a program) - it is only shown in its folder.
// v1 scope: matches inside one unwrapped buffer line; wrapped long paths are not joined.

import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { openExternal, revealPath } from "../../lib/ipc";

// `@` is excluded everywhere: `www.good.com@evil.com` would parse as userinfo@host and
// send the click to evil.com.
const WWW_RE = /\bwww\.[\w-]+(?:\.[\w-]+)+[^\s"'<>()@]*/g;
// Drive-letter paths only (C:\..., D:/...). WSL/Unix paths are out of scope for v1:
// they do not exist on the Windows filesystem Explorer can show.
const WIN_PATH_RE = /[A-Za-z]:[\\/][^\s"'<>|*?]+/g;

interface Match {
  x0: number;
  text: string;
  activate: () => void;
}

function findMatches(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(WWW_RE)) {
    const t = m[0];
    out.push({ x0: m.index, text: t, activate: () => void openExternal(`https://${t}`) });
  }
  for (const m of text.matchAll(WIN_PATH_RE)) {
    // Trailing punctuation is almost always sentence context, not the path.
    const t = m[0].replace(/[.,;:!)\]]+$/, "");
    if (t.length < 4) continue;
    out.push({ x0: m.index, text: t, activate: () => void revealPath(t) });
  }
  return out;
}

export class ExtraLinksProvider implements ILinkProvider {
  constructor(private readonly term: Terminal) {}

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.term.buffer.active.getLine(y - 1);
    if (!line) return callback(undefined);
    const links = findMatches(line.translateToString(true)).map((m): ILink => {
      const start: IBufferCellPosition = { x: m.x0 + 1, y };
      const end: IBufferCellPosition = { x: m.x0 + m.text.length, y };
      return {
        range: { start, end },
        text: m.text,
        activate: (event) => {
          event.preventDefault();
          m.activate();
        },
      };
    });
    callback(links.length ? links : undefined);
  }
}
