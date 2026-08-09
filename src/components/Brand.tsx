import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-900 text-white ring-1 ring-brand-800">
        {/* pickleball paddle mark — lime ball perforations */}
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <circle cx="10" cy="9" r="6.5" fill="#ffffff" opacity="0.95" />
          <rect x="13" y="12" width="2.4" height="9" rx="1" transform="rotate(-38 14 16)" fill="#ffffff" opacity="0.95" />
          <circle cx="8" cy="7" r="0.95" fill="#a9d329" />
          <circle cx="11.5" cy="8.5" r="0.95" fill="#a9d329" />
          <circle cx="9" cy="11" r="0.95" fill="#a9d329" />
          <circle cx="12" cy="11.5" r="0.95" fill="#a9d329" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block text-[16px] font-extrabold uppercase tracking-tight text-brand-900">
          PURE{" "}
          <span className="border-b-2 border-accent-500 pb-0.5">Academy</span>
        </span>
        <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-brand-400">
          Arizona Club Pickleball
        </span>
      </span>
    </Link>
  );
}
