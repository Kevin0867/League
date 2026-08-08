import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-bold text-brand-800">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
        {/* simple pickleball paddle mark */}
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="10" cy="9" r="6.5" opacity="0.9" />
          <rect x="13" y="12" width="2.4" height="9" rx="1" transform="rotate(-38 14 16)" />
          <circle cx="8" cy="7" r="0.9" fill="#164ae1" />
          <circle cx="11.5" cy="8.5" r="0.9" fill="#164ae1" />
          <circle cx="9" cy="11" r="0.9" fill="#164ae1" />
        </svg>
      </span>
      <span className="leading-tight">
        PURE Academy
        <span className="block text-[11px] font-medium text-slate-400">
          Arizona Club Pickleball
        </span>
      </span>
    </Link>
  );
}
