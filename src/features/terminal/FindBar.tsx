import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useUI } from "../../store/ui";
import { getTerminal } from "./controller";

/** Search bar over the active pane, driving xterm's SearchAddon (Ctrl+Shift+F). */
export function FindBar({ sessionId }: { sessionId: string }) {
  const setFind = useUI((s) => s.setFind);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = () => {
    getTerminal(sessionId)?.clearSearch();
    setFind(false);
    getTerminal(sessionId)?.focus();
  };

  return (
    <div className="find-bar" role="search" aria-label="Find in terminal">
      <input
        ref={inputRef}
        className="find-input"
        aria-label="Search text"
        placeholder="Find..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          getTerminal(sessionId)?.searchNext(e.target.value, true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            getTerminal(sessionId)?.searchPrev(query);
          } else if (e.key === "Enter") {
            e.preventDefault();
            getTerminal(sessionId)?.searchNext(query);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <button
        className="icon-btn sm"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        onClick={() => getTerminal(sessionId)?.searchPrev(query)}
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="icon-btn sm"
        title="Next match (Enter)"
        aria-label="Next match"
        onClick={() => getTerminal(sessionId)?.searchNext(query)}
      >
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn sm" title="Close" aria-label="Close find bar" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}
