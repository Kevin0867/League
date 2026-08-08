import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";

export default function ThanksPage() {
  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">
          ✓
        </div>
        <h1 className="mt-6 text-3xl font-bold text-slate-900">Registration received</h1>
        <p className="mt-3 text-slate-600">
          Thanks! You&apos;re on the list. The Academy Director will place you on a
          team after the Week-1 assessment. We&apos;ll email you your team, coach,
          location, day, and time — and only then request the season fee.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="btn-primary">Log in to your portal</Link>
          <Link href="/" className="btn-secondary">Back home</Link>
        </div>
      </div>
    </div>
  );
}
