// Output parsers for the headless AI CLIs. Rust streams raw stdout chunks; these turn
// them into displayable markdown deltas plus (for Claude) the conversation id to
// resume the next turn with.

export interface ParsedEvent {
  /** Markdown text to append to the assistant message. */
  delta?: string;
  /** Provider conversation id captured from the stream. */
  resume?: string;
}

/**
 * Claude Code `--output-format stream-json --verbose`: one JSON object per line.
 * Assistant messages arrive as complete blocks; the final `result` line repeats the
 * last text, so only its session_id is used. Unknown or partial lines are held in the
 * carry buffer until their newline arrives.
 */
export function createClaudeParser(): (chunk: string) => ParsedEvent[] {
  let carry = "";
  let emittedText = false;
  return (chunk) => {
    const events: ParsedEvent[] = [];
    carry += chunk;
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // non-JSON noise (npm warnings etc.) - never crash the stream
      }
      const ev = obj as {
        type?: string;
        session_id?: string;
        message?: { content?: { type?: string; text?: string }[] };
        result?: string;
        is_error?: boolean;
        subtype?: string;
      };
      if (typeof ev.session_id === "string" && ev.session_id) {
        events.push({ resume: ev.session_id });
      }
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        for (const block of ev.message.content) {
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            events.push({ delta: (emittedText ? "\n\n" : "") + block.text });
            emittedText = true;
          }
        }
      }
      // Fallback: some result-only replies (or errors) never emitted an assistant block.
      if (ev.type === "result" && !emittedText && typeof ev.result === "string" && ev.result) {
        events.push({ delta: ev.result });
        emittedText = true;
      }
    }
    return events;
  };
}

/** Gemini CLI `-p`: plain markdown text on stdout, no session protocol. */
export function createGeminiParser(): (chunk: string) => ParsedEvent[] {
  return (chunk) => (chunk ? [{ delta: chunk }] : []);
}

export function createParser(agent: "claude" | "gemini"): (chunk: string) => ParsedEvent[] {
  return agent === "claude" ? createClaudeParser() : createGeminiParser();
}
