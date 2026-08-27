"use client";

import { useState, useRef, useEffect } from "react";

// Floating "Ask Brett, the all-knowing" — a read-only admin assistant that
// rides along on every console page as a bottom-right bubble. Click to open a
// chat panel; it posts each question (with the signed console ticket) to
// /api/console/ask and renders Brett's grounded answers. Read-only: Brett looks
// things up, he never changes data.

type Turn = { role: "user" | "assistant"; text: string; tools?: string[] };

const SUGGESTIONS = [
  "Where do things stand this season?",
  "How much have we collected vs. outstanding?",
  "Which teams still need to launch?",
  "Who hasn't signed a waiver?",
];

// A simple, intelligent-looking person icon (head + shoulders) used as Brett's
// avatar — replaces the earlier paddle emoji.
function BrettAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 19.5c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6a.9.9 0 0 1-.9.9H5.9a.9.9 0 0 1-.9-.9Z" />
    </svg>
  );
}

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

export function AskBrett({ ticket, configured }: { ticket: string; configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
      setError("Couldn't reach Brett — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Bubble */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 whitespace-nowrap rounded-full bg-brand-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 ring-2 ring-accent-500 transition hover:bg-brand-800"
        aria-label="Ask Brett, the all-knowing"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-500 text-brand-900">
          <BrettAvatar className="h-4 w-4" />
        </span>
        {open ? "Close" : "Ask Brett, the all-knowing"}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[70vh] max-h-[600px] w-[calc(100vw-2.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-brand-900 px-4 py-3 text-white">
            <div className="leading-tight">
              <div className="flex items-center gap-2 font-bold">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-500 text-brand-900">
                  <BrettAvatar className="h-4 w-4" />
                </span>
                Ask Brett, the all-knowing
              </div>
              <div className="mt-0.5 text-[11px] text-brand-200">reads your data, never changes it</div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close">✕</button>
          </div>

          {!configured ? (
            <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Brett isn&apos;t switched on yet.</div>
              <p className="mt-1.5 leading-relaxed">
                Set an <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> in the
                production environment (Vercel → Settings → Environment Variables) and redeploy.
                Once the key is present, Brett starts answering.
              </p>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
                {turns.length === 0 && (
                  <div className="py-4 text-center">
                    <p className="px-4 text-sm text-slate-500">
                      Ask about registrations, revenue, teams, coaches, or waivers in plain English.
                    </p>
                    <div className="mt-3 flex flex-col gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => ask(s)}
                          className="mx-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 hover:border-accent-400 hover:bg-accent-50"
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
                          ? "max-w-[90%] rounded-2xl rounded-br-sm bg-brand-900 px-3 py-2 text-sm text-white"
                          : "max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800"
                      }
                    >
                      <div className="space-y-1 leading-relaxed">{renderText(t.text)}</div>
                      {t.tools && t.tools.length > 0 && (
                        <div className="mt-1.5 border-t border-slate-200 pt-1 text-[10px] text-slate-400">
                          Looked up: {t.tools.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {busy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-400">Brett is thinking…</div>
                  </div>
                )}
              </div>

              {error && <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

              <form
                onSubmit={(e) => { e.preventDefault(); ask(input); }}
                className="flex items-end gap-2 border-t border-slate-200 p-2.5"
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                  rows={1}
                  placeholder="Ask Brett…"
                  className="max-h-28 min-h-[40px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-10 shrink-0 px-4 text-sm disabled:opacity-50">
                  Ask
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
