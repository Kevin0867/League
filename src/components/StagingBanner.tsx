// A thin, unmistakable banner shown only on the staging/test deployment so
// nobody confuses it with the live site. Driven by NEXT_PUBLIC_APP_ENV, set to
// "staging" in the staging environment's Vercel env vars (unset in production).
export function StagingBanner() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging") return null;
  return (
    <div className="sticky top-0 z-[60] bg-amber-500 px-3 py-1 text-center text-xs font-semibold uppercase tracking-wide text-amber-950">
      Staging — test environment · not the live site · data here is disposable
    </div>
  );
}
