import { describe, expect, it } from "vitest";
import { createClaudeParser, createGeminiParser } from "./parser";

// The Claude adapter parses `--output-format stream-json` lines arriving in arbitrary
// chunk boundaries. The contract: capture session_id, emit assistant text blocks once,
// never crash on garbage, never duplicate the final result text.
describe("claude stream-json parser", () => {
  const init = `{"type":"system","subtype":"init","session_id":"abc-123"}\n`;
  const assistant = (text: string) =>
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]}}\n`;
  const result = (text: string) =>
    `{"type":"result","result":${JSON.stringify(text)},"session_id":"abc-123"}\n`;

  it("captures the session id and emits assistant text", () => {
    const parse = createClaudeParser();
    const events = parse(init + assistant("مرحبا! **hello**"));
    expect(events.some((e) => e.resume === "abc-123")).toBe(true);
    expect(events.map((e) => e.delta).filter(Boolean).join("")).toBe("مرحبا! **hello**");
  });

  it("handles a line split across chunks", () => {
    const parse = createClaudeParser();
    const line = assistant("split across chunks");
    const first = parse(line.slice(0, 25));
    const second = parse(line.slice(25));
    const text = [...first, ...second].map((e) => e.delta).filter(Boolean).join("");
    expect(text).toBe("split across chunks");
  });

  it("does not duplicate the final result after assistant blocks", () => {
    const parse = createClaudeParser();
    const events = parse(init + assistant("the answer") + result("the answer"));
    const text = events.map((e) => e.delta).filter(Boolean).join("");
    expect(text).toBe("the answer");
  });

  it("falls back to the result text when no assistant block arrived", () => {
    const parse = createClaudeParser();
    const events = parse(init + result("only result"));
    expect(events.map((e) => e.delta).filter(Boolean).join("")).toBe("only result");
  });

  it("separates consecutive assistant messages with a blank line", () => {
    const parse = createClaudeParser();
    const events = parse(assistant("first") + assistant("second"));
    expect(events.map((e) => e.delta).filter(Boolean).join("")).toBe("first\n\nsecond");
  });

  it("ignores non-JSON noise without dying", () => {
    const parse = createClaudeParser();
    const events = parse("npm WARN something\n" + assistant("still works"));
    expect(events.map((e) => e.delta).filter(Boolean).join("")).toBe("still works");
  });
});

describe("gemini parser", () => {
  it("passes raw text through and skips empty chunks", () => {
    const parse = createGeminiParser();
    expect(parse("مرحبا ")).toEqual([{ delta: "مرحبا " }]);
    expect(parse("")).toEqual([]);
  });
});
