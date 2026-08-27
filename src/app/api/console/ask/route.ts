import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifyActionTicket, getSession } from "@/lib/auth";
import { isAdmin, can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { CONSOLE_TOOLS, CONSOLE_WRITE_TOOLS, runConsoleTool } from "@/lib/ai/consoleTools";

// "Ask the Console" — a READ-ONLY admin assistant. The model is given a set of
// safe, read-only report tools (see consoleTools.ts); it picks which to call,
// our server runs the real Prisma query, and the model answers grounded in the
// returned data. It can never mutate anything — there is no write tool.
//
// Auth mirrors the rest of the console: this runtime doesn't deliver the session
// cookie on POSTs, so the page mints a signed console ticket (on its GET render)
// and the client sends it in the body. We verify the ticket and require admin.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Overridable so the model can be tuned without a code change. Defaults to the
// current flagship; the assistant does read-only reporting, so correctness of
// tool selection matters more than raw cost here.
const MODEL = process.env.ASK_CONSOLE_MODEL || "claude-sonnet-5";
const MAX_STEPS = 8; // hard cap on tool-use round-trips per question (cost guard)

const SYSTEM_PROMPT = [
  "You are \"Brett, the all-knowing\", a friendly, sharp read-only assistant embedded in the admin console of PURE Academy, a youth & adult pickleball club running a season of teams.",
  "You help staff find information and run reports by calling the provided read-only tools. You cannot change any data — you only look things up and summarize. If asked to change something, explain where in the console they can do it themselves.",
  "",
  "Guidelines:",
  "- Always ground answers in tool results. If you don't have a tool for something, say so plainly rather than guessing.",
  "- Prefer calling a tool over speculating. For broad 'where do we stand' questions, start with season_overview.",
  "- Money is reported in whole formatted dollars from the tools; quote those figures exactly.",
  "- Be concise and scannable. Use short markdown: a one-line answer up top, then bullets or a compact table for detail.",
  "- These are real families, some of them minors. Share only what the question needs. Never invent contact details or statuses.",
  "- If a tool returns an error, tell the user what failed in plain language.",
  "",
  "Write actions (only if write tools are available to you):",
  "- Some tools change data (e.g. assign_player_to_team). Treat these with care — they are real roster changes.",
  "- NEVER call a write tool with confirm:true until the user has clearly said yes to the specific change you proposed.",
  "- First call the write tool WITHOUT confirm (or confirm:false) to preview it. The tool returns exactly which person and team it matched, plus any warning (e.g. team is at capacity). Show that back to the user and ask them to confirm.",
  "- If the tool reports it couldn't uniquely identify the person or team, relay the options it returned and ask the user to pick — do not guess.",
  "- Only after an explicit 'yes' to that exact match, call the tool again with confirm:true, then report what changed.",
].join("\n");

type ClientMsg = { role: "user" | "assistant"; text: string };

// Health check — the session cookie IS delivered on GETs, so this is admin-gated
// by the session directly. Reports whether the key is present AND whether a live
// call to the model actually succeeds, so the widget can say exactly what's wrong
// (key missing vs. model unreachable vs. connected).
export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.roles ?? [session.role])) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, model: MODEL, live: { ok: false, reason: "no-key" } });
  }
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({ model: MODEL, max_tokens: 4, messages: [{ role: "user", content: "ping" }] });
    return NextResponse.json({ configured: true, model: MODEL, live: { ok: true } });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const reason =
      status === 401 ? "bad-key"
      : status === 403 ? "no-access"
      : status === 404 ? "model-not-found"
      : status === 429 ? "rate-limited-or-no-credit"
      : "api-error";
    return NextResponse.json({
      configured: true,
      model: MODEL,
      live: { ok: false, reason, status: status ?? null, message: e instanceof Error ? e.message.slice(0, 200) : "" },
    });
  }
}

export async function POST(req: Request) {
  let body: { ticket?: string; question?: string; history?: ClientMsg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // Auth — verify the signed console ticket and require an admin role.
  const ticket = await verifyActionTicket(body.ticket, "console");
  const roles = ticket?.roles ?? (ticket?.role ? [ticket.role] : []);
  if (!ticket || !isAdmin(roles)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  }
  // Write tools (roster changes) are gated on the same permission the console
  // uses for managing teams. Read-only admins get the read tools only.
  const canWrite = can(roles, "manageTeams");

  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ ok: false, error: "Ask a question." }, { status: 400 });
  if (question.length > 2000) {
    return NextResponse.json({ ok: false, error: "That question is too long." }, { status: 400 });
  }

  // Graceful degradation — mirror how Stripe/Zoho report "not configured".
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, configured: false, error: "The assistant isn't configured yet — set ANTHROPIC_API_KEY in the environment to enable it." },
      { status: 200 },
    );
  }

  const client = new Anthropic({ apiKey });

  // Rebuild prior turns as plain text (we keep the server stateless; the tool
  // loop re-runs fresh each question). Cap history so context stays bounded.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.text }));

  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: question }];
  const toolsUsed: string[] = [];

  try {
    let steps = 0;
    while (steps < MAX_STEPS) {
      steps++;
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: canWrite ? [...CONSOLE_TOOLS, ...CONSOLE_WRITE_TOOLS] : CONSOLE_TOOLS,
        messages,
      });

      if (resp.stop_reason === "tool_use") {
        // Preserve the assistant turn verbatim, then answer each tool_use block.
        messages.push({ role: "assistant", content: resp.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of resp.content) {
          if (block.type === "tool_use") {
            toolsUsed.push(block.name);
            const result = await runConsoleTool(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
              { actorId: ticket.userId, canWrite },
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Final answer.
      const answer = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      await audit({
        actorId: ticket.userId,
        entityType: "Console",
        entityId: "ask",
        action: "ASK",
        summary: question.slice(0, 300),
        metadata: { toolsUsed, steps },
      });

      return NextResponse.json({
        ok: true,
        answer: answer || "I couldn't produce an answer for that — try rephrasing.",
        toolsUsed: [...new Set(toolsUsed)],
      });
    }

    // Ran out of tool-use steps without a final answer.
    await audit({
      actorId: ticket.userId, entityType: "Console", entityId: "ask", action: "ASK",
      summary: question.slice(0, 300), metadata: { toolsUsed, steps, truncated: true },
    });
    return NextResponse.json({
      ok: true,
      answer: "That took more steps than I could complete in one go. Try narrowing the question.",
      toolsUsed: [...new Set(toolsUsed)],
    });
  } catch (e) {
    console.error("ask-the-console failed", e);
    const msg = e instanceof Anthropic.APIError
      ? "The assistant service returned an error. Please try again."
      : "Something went wrong answering that. Please try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
