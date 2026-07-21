import type { ReactNode } from "react";
import { Bot, SquareTerminal } from "lucide-react";
import { siClaude, siGooglegemini } from "simple-icons";

// One icon source of truth. AI agents use their real brand logos (simple-icons, vector =
// any resolution). OpenAI's logo was removed from the set at their request, so Codex uses
// a neutral mark rather than a hand-faked trademark. Shells use the Lucide terminal glyph.

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
