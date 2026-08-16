import { prisma } from "@/lib/db";
import { verifyCheckinToken } from "@/lib/domain/sessionCheckin";
import { Logo } from "@/components/Brand";
import { formatDate, formatTimeRange12 } from "@/lib/time";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "practice",
  LEAGUE_MATCH: "league match",
  CHAMPIONSHIP: "championship",
  ALA_CARTE: "session",
};

const ERRORS: Record<string, string> = {
  token: "This check-in link is invalid or has expired. Text us and we'll sort it out.",
  cancelled: "This session was cancelled — no need to check in.",
  roster: "We couldn't match you to this session's roster. Please see your coach.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Logo />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pure-pickleball-padel.png" alt="PURE Pickleball & Padel" className="h-9 w-auto" />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-10">{children}</main>
    </div>
  );
}

export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const claims = await verifyCheckinToken(token);
  if (!claims) {
    return (
      <Shell>
        <div className="card text-center">
          <h1 className="text-2xl font-bold text-slate-900">Link expired</h1>
          <p className="mt-2 text-slate-600">{ERRORS[sp.err ?? "token"] ?? ERRORS.token}</p>
        </div>
      </Shell>
    );
  }

  const [session, person, already] = await Promise.all([
    prisma.session.findUnique({
      where: { id: claims.sessionId },
      include: {
        facility: { select: { name: true, notes: true } },
        teams: { include: { team: { select: { name: true } } } },
      },
    }),
    prisma.person.findUnique({ where: { id: claims.personId }, select: { firstName: true } }),
    prisma.attendance.findUnique({
      where: { sessionId_personId: { sessionId: claims.sessionId, personId: claims.personId } },
      select: { status: true },
    }),
  ]);

  if (!session || !person) {
    return (
      <Shell>
        <div className="card text-center">
          <h1 className="text-2xl font-bold text-slate-900">Link expired</h1>
          <p className="mt-2 text-slate-600">{ERRORS.token}</p>
        </div>
      </Shell>
    );
  }

  const kind = TYPE_LABEL[session.type] ?? "session";
  const teamNames = session.teams.map((t) => t.team.name).join(", ");
  const checkedIn = sp.ok === "1" || already?.status === "PRESENT";

  return (
    <Shell>
      {/* Session details — always shown, so the text link is genuinely useful:
          who, when, where. */}
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">PURE Academy {kind}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Hi {person.firstName}!</h1>
        {teamNames && <p className="mt-1 text-slate-600">{teamNames}</p>}

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">When</dt>
            <dd className="text-right font-medium text-slate-800">
              {formatDate(session.date)}
              <br />
              {formatTimeRange12(session.startTime, session.endTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Where</dt>
            <dd className="text-right font-medium text-slate-800">{session.facility?.name ?? "TBD"}</dd>
          </div>
        </dl>

        {session.facility?.notes && (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{session.facility.notes}</p>
        )}
      </div>

      {sp.err && ERRORS[sp.err] && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err]}</p>
      )}

      {checkedIn ? (
        <div className="card mt-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl">✓</div>
          <h2 className="mt-3 text-lg font-bold text-slate-900">You&apos;re checked in</h2>
          <p className="mt-1 text-sm text-slate-600">Your coach can see you&apos;ve arrived. Have a great {kind}!</p>
        </div>
      ) : session.status === "CANCELLED" ? (
        <div className="card mt-4 text-center">
          <h2 className="text-lg font-bold text-slate-900">This session was cancelled</h2>
          <p className="mt-1 text-sm text-slate-600">No need to check in.</p>
        </div>
      ) : (
        <form method="POST" action="/api/checkin" className="mt-4">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn-primary w-full py-3 text-base">
            Check in {person.firstName}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">Tap once you&apos;ve arrived at the courts.</p>
        </form>
      )}
    </Shell>
  );
}
