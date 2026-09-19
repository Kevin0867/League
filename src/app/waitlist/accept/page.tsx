import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getWaitlistOffer } from "@/lib/domain/teamWaitlist";

export const dynamic = "force-dynamic";
export const metadata = { title: "Waitlist spot — PURE Academy" };

export default async function WaitlistAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; team?: string }>;
}) {
  const { token, done, team } = await searchParams;

  // Post-action outcomes.
  if (done) {
    const box = (title: string, body: string, tone: "ok" | "warn") => (
      <div className={`rounded-2xl border p-6 ${tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm">{body}</p>
      </div>
    );
    let content;
    if (done === "accepted") content = box("You're on the team! 🎉", `Welcome to ${team ? decodeURIComponent(team) : "the team"}! Check your email and texts — we've sent your team details plus the link to pay your (prorated) season fee and pick your apparel. See you on the court!`, "ok");
    else if (done === "declined") content = box("Spot declined", "No problem — we've passed the spot to the next person on the waitlist. If you'd still like to join another team, browse open spots any time.", "warn");
    else if (done === "expired") content = box("This offer has expired", "This spot's 24-hour window has passed, so it's moved on to the next person. Keep an eye out — if another spot opens and you're next, we'll reach out again.", "warn");
    else if (done === "full") content = box("That spot just filled", "Sorry — the spot was taken before you accepted. You're still on the waitlist and we'll reach out if another opens.", "warn");
    else content = box("Link not valid", "This link is invalid or has already been used. If you think a spot is still open for you, reply to our text or email and we'll help.", "warn");
    return (
      <div>
        <PublicNav />
        <div className="mx-auto max-w-xl px-4 py-16">{content}</div>
        <SiteFooter />
      </div>
    );
  }

  const offer = token ? await getWaitlistOffer(token) : { valid: false as const, reason: "invalid" as const };

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-16">
        {!offer.valid ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            <h1 className="text-xl font-bold">
              {offer.reason === "expired" ? "This offer has expired" : "Link not valid"}
            </h1>
            <p className="mt-2 text-sm">
              {offer.reason === "expired"
                ? "This spot's 24-hour window has passed and it's moved to the next person. If another spot opens and you're next, we'll reach out again."
                : "This link is invalid or has already been used. If you think a spot is still open for you, reply to our text or email and we'll help."}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="eyebrow">Waitlist</p>
            <h1 className="display mt-2 text-2xl text-brand-900">A spot opened on {offer.teamName}!</h1>
            <p className="mt-3 text-slate-600">
              {offer.firstName ? `${offer.firstName}, you're` : "You're"} next on the waitlist and a spot just opened up. Accept below to claim it
              {offer.expiresAt ? (
                <> — this offer expires <span className="font-semibold">{offer.expiresAt.toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} AZ</span>.</>
              ) : "."}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              When you accept, we&apos;ll send your team details and the link to pay your (prorated) season fee and pick your apparel. If you can&apos;t make it, decline and we&apos;ll offer the spot to the next person.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <form method="POST" action="/api/waitlist/accept">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="op" value="accept" />
                <button className="btn-primary justify-center">Accept my spot →</button>
              </form>
              <form method="POST" action="/api/waitlist/accept">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="op" value="decline" />
                <button className="btn-ghost justify-center">Can&apos;t make it — decline</button>
              </form>
            </div>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
