import { describe, expect, it } from "vitest";
import { capToolResult, runAgentLoop, type AgentEvent, type AssistantMessage, type ToolOutcome } from "../src/agent-loop";

const TOOLS = [
  { name: "shortlist", description: "x", parameters: { type: "object", properties: {} } },
  { name: "hold_payment", description: "x", parameters: { type: "object", properties: {} } },
];
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: "function" as const, function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
function scripted(replies: AssistantMessage[]) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)]!;
}
const ok = (json: Record<string, unknown> = {}): ToolOutcome => ({ status: 200, json });

describe("runAgentLoop", () => {
  it("runs tools, feeds results back, and stops on a plain answer", async () => {
    const events: AgentEvent[] = [];
    const result = await runAgentLoop({
      system: "s", task: "t", tools: TOOLS, onEvent: (e) => events.push(e),
      chat: scripted([{ role: "assistant", content: "Searching.", tool_calls: [call("1", "shortlist", { query: "mouse" })] }, { role: "assistant", content: "Done." }]),
      execute: async () => ok({ results: [] }),
    });
    expect(result.reason).toBe("final");
    expect(result.finalText).toBe("Done.");
    expect(events.map((e) => e.type)).toEqual(["model", "tool_call", "tool_result", "model", "done"]);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("answers every tool call exactly once, even for unknown tools and bad JSON", async () => {
    let executed = 0;
    const result = await runAgentLoop({
      system: "s", task: "t", tools: TOOLS,
      chat: scripted([
        { role: "assistant", content: null, tool_calls: [call("a", "rewrite_rules"), call("b", "shortlist", "{not json"), call("c", "shortlist", [1, 2])] },
        { role: "assistant", content: "ok" },
      ]),
      execute: async () => { executed += 1; return ok(); },
    });
    expect(executed).toBe(0);
    const toolMessages = result.messages.filter((m) => m.role === "tool") as Array<{ tool_call_id: string; content: string }>;
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(["a", "b", "c"]);
    expect(toolMessages[0]!.content).toMatch(/no tool called/);
    expect(toolMessages[1]!.content).toMatch(/not valid JSON/);
  });

  it("limits parallel calls but still replies to each", async () => {
    const executed: string[] = [];
    const result = await runAgentLoop({
      system: "s", task: "t", tools: TOOLS, maxCallsPerTurn: 1,
      chat: scripted([{ role: "assistant", content: null, tool_calls: [call("1", "shortlist"), call("2", "shortlist")] }, { role: "assistant", content: "ok" }]),
      execute: async (name) => { executed.push(name); return ok(); },
    });
    expect(executed).toEqual(["shortlist"]);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("surfaces a refusal and lets the model explain it", async () => {
    const events: AgentEvent[] = [];
    await runAgentLoop({
      system: "s", task: "t", tools: TOOLS, onEvent: (e) => events.push(e),
      chat: scripted([{ role: "assistant", content: null, tool_calls: [call("1", "hold_payment")] }, { role: "assistant", content: "I can't do that without you." }]),
      execute: async () => ({ status: 403, json: { error: "Needs a human", requiresHuman: true } }),
    });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ refused: true, status: 403 });
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "final" });
  });

  it("stops for a human after the turn in which a tool asks for one", async () => {
    let chats = 0;
    const result = await runAgentLoop({
      system: "s", task: "t", tools: TOOLS,
      chat: async () => { chats += 1; return { role: "assistant", content: "Placing a hold.", tool_calls: [call("1", "hold_payment")] }; },
      execute: async () => ({ status: 200, json: { approvalUrl: "https://x" }, stop: true }),
    });
    expect(result.reason).toBe("human_needed");
    expect(chats).toBe(1);
  });

  it("is bounded, and survives a tool that throws", async () => {
    const result = await runAgentLoop({
      system: "s", task: "t", tools: TOOLS, maxSteps: 3,
      chat: async () => ({ role: "assistant", content: null, tool_calls: [call(`c${Math.random()}`, "shortlist")] }),
      execute: async () => { throw new Error("catalog down"); },
    });
    expect(result.reason).toBe("max_steps");
    expect(result.steps).toBe(3);
    expect((result.messages.find((m) => m.role === "tool") as { content: string }).content).toMatch(/catalog down/);
  });

  it("stops at once when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgentLoop({ system: "s", task: "t", tools: TOOLS, signal: controller.signal, chat: async () => { throw new Error("should not be called"); }, execute: async () => ok() });
    expect(result.reason).toBe("aborted");
  });
});

describe("capToolResult", () => {
  it("keeps small results whole and shrinks big lists into valid JSON", () => {
    expect(capToolResult({ a: 1 }, 100)).toBe('{"a":1}');
    const big = { results: Array.from({ length: 200 }, (_, i) => ({ i, pad: "x".repeat(50) })) };
    const capped = capToolResult(big, 2000);
    expect(capped.length).toBeLessThanOrEqual(2000);
    expect(JSON.parse(capped)._truncated).toBe(true);
    expect(JSON.parse(capToolResult({ x: "y".repeat(5000) }, 300))._truncated).toBe(true);
  });
});
