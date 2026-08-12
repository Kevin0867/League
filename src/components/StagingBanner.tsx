// A thin, unmistakable banner shown only on the NON-production (test) platform
// so nobody confuses it with the live site. Driven by NEXT_PUBLIC_APP_ENV, set
// to "test" (or "staging") in this environment's Vercel env vars and left UNSET
// in production, where this renders nothing.
export function StagingBanner() {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  if (env !== "test" && env !== "staging") return null;
  return (
    <div className="sticky top-0 z-[60] bg-amber-500 px-3 py-1 text-center text-xs font-semibold uppercase tracking-wide text-amber-950">
      Test platform · not the live site · changes here don&apos;t affect production
    </div>
  );
}
