/**
 * The Muse agent loop. A model is given a handful of tools and decides which to call. This file is the part that
 * has to be right no matter what the model does:
 *
 *   - every tool call gets exactly one tool reply (the chat API rejects a transcript that skips one),
 *   - bad JSON arguments, unknown tools and too many parallel calls are answered, never executed,
 *   - tool output is size-capped before it goes back into the model's context,
 *   - the loop is bounded, and it stops the moment a tool says a human must act.
 *
 * It knows nothing about payments. What the agent may actually DO is decided by the tools it is handed (PactPay's
 * gateway) and by the fixed settlement gate behind them.
 */
export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall { id: string; type?: "function"; function: { name: string; arguments: string } }
export interface AssistantMessage { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolOutcome {
  status: number;
  json: Record<string, unknown>;
  /** The gate refused this (autonomy limit, blocked offer). The agent must explain, not work around it. */
  refused?: boolean;
  /** Stop the loop after this turn: a human has to do something before the agent can continue. */
  stop?: boolean;
}

export type AgentEvent =
  | { type: "model"; step: number; text: string }
  | { type: "tool_call"; step: number; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; step: number; id: string; name: string; status: number; refused: boolean; data: Record<string, unknown> }
  | { type: "done"; reason: "final" | "human_needed" | "max_steps" | "aborted"; steps: number };

export interface AgentLoopOptions {
  system: string;
  task: string;
  tools: readonly AgentToolSpec[];
  chat: (messages: readonly ChatMessage[], tools: readonly AgentToolSpec[]) => Promise<AssistantMessage>;
  execute: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  onEvent?: (event: AgentEvent) => void;
  maxSteps?: number;
  maxCallsPerTurn?: number;
  maxToolChars?: number;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  messages: ChatMessage[];
  reason: "final" | "human_needed" | "max_steps" | "aborted";
  steps: number;
  finalText: string;
}

function parseArgs(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false } {
  if (!raw.trim()) return { ok: true, args: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ok: true, args: parsed as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Keeps a tool result small enough to put back in the model's context without cutting JSON mid-way. */
export function capToolResult(json: Record<string, unknown>, maxChars: number): string {
  const full = JSON.stringify(json);
  if (full.length <= maxChars) return full;
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    trimmed[key] = Array.isArray(value) ? value.slice(0, 6) : value;
  }
  const retry = JSON.stringify({ ...trimmed, _truncated: true });
  return retry.length <= maxChars ? retry : JSON.stringify({ _truncated: true, note: "The result was too large to show.", keys: Object.keys(json).slice(0, 12) });
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxSteps = options.maxSteps ?? 8;
  const maxCalls = options.maxCallsPerTurn ?? 3;
  const maxChars = options.maxToolChars ?? 6000;
  const known = new Set(options.tools.map((tool) => tool.name));
  const messages: ChatMessage[] = [{ role: "system", content: options.system }, { role: "user", content: options.task }];
  const emit = (event: AgentEvent) => options.onEvent?.(event);
  let finalText = "";

  for (let step = 1; step <= maxSteps; step += 1) {
    if (options.signal?.aborted) { emit({ type: "done", reason: "aborted", steps: step - 1 }); return { messages, reason: "aborted", steps: step - 1, finalText }; }
    const reply = await options.chat(messages, options.tools);
    const calls = (reply.tool_calls ?? []).filter((call) => typeof call?.id === "string" && typeof call.function?.name === "string");
    messages.push({ role: "assistant", content: reply.content ?? null, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
    const said = (reply.content ?? "").trim();
    if (said) { finalText = said; emit({ type: "model", step, text: said }); }
    if (calls.length === 0) { emit({ type: "done", reason: "final", steps: step }); return { messages, reason: "final", steps: step, finalText }; }

    let stop = false;
    for (const [index, call] of calls.entries()) {
      const name = call.function.name;
      const parsed = parseArgs(call.function.arguments ?? "");
      const args = parsed.ok ? parsed.args : {};
      emit({ type: "tool_call", step, id: call.id, name, args });
      let outcome: ToolOutcome;
      if (index >= maxCalls) outcome = { status: 429, json: { error: `Only ${maxCalls} tool calls per turn are allowed. Call this one again next turn.` } };
      else if (!known.has(name)) outcome = { status: 400, json: { error: `There is no tool called "${name}". Available tools: ${[...known].join(", ")}.` } };
      else if (!parsed.ok) outcome = { status: 400, json: { error: "The tool arguments were not valid JSON. Send a JSON object." } };
      else {
        try { outcome = await options.execute(name, args); }
        catch (error) { outcome = { status: 502, json: { error: error instanceof Error ? error.message.slice(0, 200) : "The tool failed." } }; }
      }
      const refused = outcome.refused === true || outcome.status === 403;
      emit({ type: "tool_result", step, id: call.id, name, status: outcome.status, refused, data: outcome.json });
      messages.push({ role: "tool", tool_call_id: call.id, content: capToolResult(outcome.json, maxChars) });
      if (outcome.stop) stop = true;
    }
    if (stop) { emit({ type: "done", reason: "human_needed", steps: step }); return { messages, reason: "human_needed", steps: step, finalText }; }
  }
  emit({ type: "done", reason: "max_steps", steps: maxSteps });
  return { messages, reason: "max_steps", steps: maxSteps, finalText };
}
