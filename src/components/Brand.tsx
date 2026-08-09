import Link from "next/link";

// Official PURE Academy logo. Assets live in /public/brand — drop-in replace
// those SVGs with the official files to make this pixel-perfect.
//   variant="navy"  → navy wordmark, for light surfaces (default)
//   variant="white" → white wordmark, for dark surfaces (hero, footer)
export function Logo({
  href = "/",
  variant = "navy",
  className = "h-10",
}: {
  href?: string;
  variant?: "navy" | "white";
  className?: string;
}) {
  const src = variant === "white" ? "/brand/pure-academy-white.svg" : "/brand/pure-academy-navy.svg";
  return (
    <Link href={href} className="inline-flex items-center" aria-label="PURE Academy home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="PURE Academy" className={`${className} w-auto`} />
    </Link>
  );
}
