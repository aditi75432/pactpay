"use client";

import { useEffect, useState } from "react";
import ClassicAgent from "./ClassicAgent";
import MuseAgent from "./MuseAgent";

/**
 * Step 2 of the one workflow (Shop -> Agent -> Order). An AI agent does the shopping. If no AI model is configured,
 * or you ask for it, PactPay's rule-based agent runs the same step instead; the gate and the next steps are identical.
 */
export default function AgentStep() {
  const [mode, setMode] = useState<"loading" | "ai" | "classic">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let q = params.get("query")?.trim() ?? "";
    if (!q) { try { q = (JSON.parse(window.sessionStorage.getItem("pactpay.activeIntent.v1") ?? "{}") as { searchQuery?: string }).searchQuery ?? ""; } catch { /* none */ } }
    setQuery(q);
    if (params.get("mode") === "classic") { setMode("classic"); return; }
    fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((status) => setMode(status.configured ? "ai" : "classic"))
      .catch(() => setMode("classic"));
  }, []);

  if (mode === "loading") return null;
  if (mode === "classic") return <ClassicAgent />;
  return <MuseAgent searchQuery={query} onUseClassic={() => { const url = new URL(window.location.href); url.searchParams.set("mode", "classic"); window.location.href = url.toString(); }} />;
}
