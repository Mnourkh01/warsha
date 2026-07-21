import type { ReactNode } from "react";
import { Bot, SquareTerminal } from "lucide-react";
import { siClaude, siGooglegemini } from "simple-icons";

// One icon source of truth. AI agents use their real brand logos (simple-icons, vector =
// any resolution). OpenAI's logo was removed from the set at their request, so Codex uses
// a neutral mark rather than a hand-faked trademark. Shells use the Lucide terminal glyph.

// The brand mark (prompt chevron + anvil), same paths as app-icon.svg / docs/brand.
// Fixed brand violets in both themes; it sits next to the wordmark, not body text.
export function WarshaMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="76 138 372 238"
      width={Math.round(size * 1.56)}
      height={size}
      aria-hidden="true"
    >
      <path d="M88 150 L238 257 L88 364 L88 312 L164 257 L88 202 Z" fill="#8b7cf6" />
      <path
        d="M210 170 H374 L436 190 L434 196 Q390 214 360 218 L352 218 L344 252 L364 286 L386 286 L386 320 L406 320 L406 344 L214 344 L214 320 L234 320 L234 286 L256 286 L276 252 L268 218 L210 218 Z"
        fill="#6d4fd6"
      />
    </svg>
  );
}

function Badge({ bg, size, children }: { bg: string; size: number; children: ReactNode }) {
  return (
    <span className="brand-badge" style={{ background: bg, width: size, height: size }}>
      {children}
    </span>
  );
}

function Glyph({ path, size }: { path: string; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#fff" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function SessionIcon({ typeId, size = 20 }: { typeId?: string; size?: number }) {
  const g = Math.round(size * 0.62);
  switch (typeId) {
    case "claude":
      return (
        <Badge bg={`#${siClaude.hex}`} size={size}>
          <Glyph path={siClaude.path} size={g} />
        </Badge>
      );
    case "gemini":
      return (
        <Badge bg={`#${siGooglegemini.hex}`} size={size}>
          <Glyph path={siGooglegemini.path} size={g} />
        </Badge>
      );
    case "codex":
      return (
        <Badge bg="#141317" size={size}>
          <Bot size={g} color="#fff" />
        </Badge>
      );
    default:
      return (
        <span className="row-icon">
          <SquareTerminal size={Math.round(size * 0.72)} />
        </span>
      );
  }
}
