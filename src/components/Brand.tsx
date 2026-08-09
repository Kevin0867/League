import Link from "next/link";

// Official PURE Academy logo (white wordmark on navy). Because the artwork has a
// solid navy background, we clip it into a rounded "tile" so it reads as an
// intentional logo lozenge on light surfaces (header, login, portal).
// Files live in /public/brand: pure-academy-navy.png, -black.png, -elite.png.
export function Logo({
  href = "/",
  className = "h-11",
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="PURE Academy home"
      className="inline-flex overflow-hidden rounded-lg ring-1 ring-black/5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/pure-academy-navy.png" alt="PURE Academy" className={`${className} w-auto`} />
    </Link>
  );
}

// PURE Pickleball & Padel parent-brand logo (navy on transparent). Sits top-right
// across the app so every surface shows PURE Academy's association with PURE
// Pickleball & Padel. Paired with <Logo /> (Academy) on the top-left.
export function PadelLogo({ className = "h-9" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/pure-pickleball-padel.png"
      alt="PURE Pickleball & Padel"
      className={`${className} w-auto`}
    />
  );
}
