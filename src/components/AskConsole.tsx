"use client";

import { useState, useRef, useEffect } from "react";

// Client chat UI for "Ask the Console". Keeps the running transcript in state,
// posts each question (with the signed console ticket) to /api/console/ask, and
// renders the assistant's grounded answers. Read-only — the assistant can only
// look things up, never change data.

type Turn = { role: "user" | "assistant"; text: string; tools?: string[] };

const SUGGESTIONS = [
  "Where do things stand this season?",
  "How much have we collected, and what's still outstanding?",
  "Which teams still need to launch?",
  "Who registered but hasn't signed a waiver?",
];

// Minimal, safe markdown → very light formatting (bold + line breaks + bullets).
function renderText(text: string) {
  return text.split("\n").map((line, i) => {
    const bulleted = /^\s*[-*]\s+/.test(line);
    const content = line.replace(/^\s*[-*]\s+/, "");
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
    );
    return (
      <div key={i} className={bulleted ? "flex gap-2 pl-1" : ""}>
        {bulleted && <span className="text-accent-600">•</span>}
        <span>{parts}</span>
      </div>
    );
  });
}

export function AskConsole({ ticket, configured }: { ticket: string; configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError("");
    setInput("");
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/console/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, question: q, history }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; answer?: string; error?: string; toolsUsed?: string[];
      };
      if (res.ok && data.ok && data.answer) {
        setTurns((prev) => [...prev, { role: "assistant", text: data.answer!, tools: data.toolsUsed }]);
      } else {
        setError(data.error || "Something went wrong — please try again.");
      }
    } catch {
      setError("Couldn't reach the assistant — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <div className="font-semibold">The assistant isn&apos;t switched on yet.</div>
        <p className="mt-1.5 leading-relaxed">
          Set an <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> in the
          production environment (Vercel → Project → Settings → Environment Variables) and redeploy.
          Everything else is ready — once the key is present, this page starts answering.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg py-8 text-center">
            <div className="text-sm font-semibold text-slate-700">Ask about your season</div>
            <p className="mt-1 text-sm text-slate-500">
              Find people, check revenue, see which teams are launched, spot waiver gaps — in plain English.
              This assistant reads your data only; it can&apos;t change anything.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-accent-400 hover:bg-accent-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                t.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-brand-900 px-4 py-2.5 text-sm text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-800"
              }
            >
              <div className="space-y-1 leading-relaxed">{renderText(t.text)}</div>
              {t.tools && t.tools.length > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-1.5 text-[11px] text-slate-400">
                  Looked up: {t.tools.join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-end gap-2 border-t border-slate-200 p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
          }}
          rows={1}
          placeholder="Ask about registrations, revenue, teams, waivers…"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-accent-500 focus:outline-none"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-primary h-11 shrink-0 px-5 text-sm disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
