"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import {
  unitPriceCents,
  garmentLabel,
  sizeLabel,
  type Garment,
  type SizeKey,
} from "@/lib/domain/apparel";

type Line = { garment: Garment; size: SizeKey; quantity: number; personId: string | null };
type Player = { id: string; name: string };

/** Simple black-outline garment icons (no photo) so a buyer sees the difference:
 *  a T-shirt has short sleeves; a tank top has straps and no sleeves. */
function GarmentIcon({ garment }: { garment: Garment }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-slate-900" aria-hidden="true">
      {garment === "TANK" ? (
        // Tank top: neckline scoop, thin straps, no sleeves.
        <path d="M16 2a4 4 0 0 1-8 0L7.4 2.3C6.6 4 6 6 6 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8c0-2-.6-4-1.4-5.7z" />
      ) : (
        // T-shirt: neckline scoop with short sleeves out to the shoulders.
        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
      )}
    </svg>
  );
}

const YOUTH: { key: SizeKey; short: string }[] = [
  { key: "YS", short: "S" },
  { key: "YM", short: "M" },
  { key: "YL", short: "L" },
  { key: "YXL", short: "XL" },
];
const ADULT: { key: SizeKey; short: string }[] = [
  { key: "AXS", short: "XS" },
  { key: "AS", short: "S" },
  { key: "AM", short: "M" },
  { key: "AL", short: "L" },
  { key: "AXL", short: "XL" },
  { key: "A2XL", short: "2XL" },
];

/**
 * Season-fee checkout with a tap-friendly team-apparel picker. Each player gets
 * their own section; within it you tap a style (T-shirt / tank), tap a size, set
 * a quantity, and add it. The season fee + apparel is charged in one Stripe
 * checkout. Checkout is blocked (with a specific reason) until every player has
 * at least one item.
 */
export function SeasonFeePayForm({
  paymentId,
  seasonFeeCents,
  shirtCents,
  tankCents,
  recommendInstall,
  perInstallmentCents,
  installmentCount,
  action = "/api/pay",
  extraFields,
  players = [],
}: {
  paymentId: string;
  seasonFeeCents: number;
  shirtCents: number;
  tankCents: number;
  recommendInstall: boolean;
  perInstallmentCents: number;
  installmentCount: number;
  action?: string;
  extraFields?: Record<string, string>;
  players?: Player[];
}) {
  const [lines, setLines] = useState<Line[]>([]);

  // Sections: one per known player, or a single anonymous section otherwise.
  const sections: { id: string | null; name: string | null }[] = players.length
    ? players.map((p) => ({ id: p.id, name: p.name }))
    : [{ id: null, name: null }];

  const priceOf = (g: Garment) => unitPriceCents(g, shirtCents, tankCents);
  const apparelCents = lines.reduce((s, l) => s + priceOf(l.garment) * l.quantity, 0);
  const totalCents = seasonFeeCents + apparelCents;

  const linesFor = (pid: string | null) => lines.filter((l) => (l.personId ?? null) === (pid ?? null));
  const sectionDone = (pid: string | null) => linesFor(pid).length > 0;
  const firstIncomplete = sections.find((s) => !sectionDone(s.id));
  const canCheckout = !firstIncomplete;

  function addLine(pid: string | null, garment: Garment, size: SizeKey, quantity: number) {
    setLines((prev) => {
      const i = prev.findIndex((l) => (l.personId ?? null) === (pid ?? null) && l.garment === garment && l.size === size);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + quantity };
        return copy;
      }
      return [...prev, { garment, size, quantity, personId: pid }];
    });
  }
  function removeLine(target: Line) {
    setLines((prev) => prev.filter((l) => l !== target));
  }

  const blockedReason = firstIncomplete
    ? firstIncomplete.name
      ? `Add a shirt or tank for ${firstIncomplete.name} to continue`
      : "Add a shirt or tank to continue"
    : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Team apparel</h2>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">Required</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Every player needs team gear. Pick a T-shirt or a tank top and a size{sections.length > 1 ? " for each player" : ""}.
        </p>

        <SizeGuide />

        <div className="mt-3 space-y-3">
          {sections.map((s) => (
            <PlayerApparel
              key={s.id ?? "solo"}
              player={s}
              multi={sections.length > 1}
              shirtCents={shirtCents}
              tankCents={tankCents}
              lines={linesFor(s.id)}
              onAdd={(g, size, qty) => addLine(s.id, g, size, qty)}
              onRemove={removeLine}
            />
          ))}
        </div>
      </div>

      {/* Order summary */}
      <dl className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Season fee</dt>
          <dd className="text-slate-700">{formatCents(seasonFeeCents)}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <dt className="text-slate-500">Team apparel</dt>
          <dd className="text-slate-700">{formatCents(apparelCents)}</dd>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
          <dt className="font-semibold text-slate-800">Total</dt>
          <dd className="text-lg font-bold text-slate-900">{formatCents(totalCents)}</dd>
        </div>
      </dl>

      <form method="POST" action={action} className="space-y-3">
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="cart" value={JSON.stringify(lines)} />
        {extraFields &&
          Object.entries(extraFields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

        <button
          name="plan"
          value="full"
          disabled={!canCheckout}
          className={`w-full rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
            recommendInstall ? "border-slate-200 bg-white hover:border-slate-300" : "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
          }`}
        >
          <span className="block font-semibold text-slate-900">Pay in full — {formatCents(totalCents)}</span>
          <span className="block text-xs text-slate-500">One secure payment now (season fee + apparel).</span>
        </button>

        <button
          name="plan"
          value="installments"
          disabled={!canCheckout}
          className={`w-full rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
            recommendInstall ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span className="block font-semibold text-slate-900">
            Pay in {installmentCount} — {formatCents(perInstallmentCents + apparelCents)} today, then 2 more
          </span>
          <span className="block text-xs text-slate-500">
            The season fee splits into {installmentCount} equal payments 30 days apart; apparel is included in
            today&apos;s first payment.
          </span>
        </button>

        {blockedReason && <p className="text-center text-sm font-medium text-amber-600">{blockedReason}</p>}
      </form>
    </div>
  );
}

/** One player's apparel picker: tap a style, tap a size, set quantity, add. */
function PlayerApparel({
  player,
  multi,
  shirtCents,
  tankCents,
  lines,
  onAdd,
  onRemove,
}: {
  player: { id: string | null; name: string | null };
  multi: boolean;
  shirtCents: number;
  tankCents: number;
  lines: Line[];
  onAdd: (g: Garment, size: SizeKey, qty: number) => void;
  onRemove: (l: Line) => void;
}) {
  const [garment, setGarment] = useState<Garment>("SHIRT");
  const [size, setSize] = useState<SizeKey | null>(null);
  const [qty, setQty] = useState(1);
  const done = lines.length > 0;
  const priceOf = (g: Garment) => (g === "TANK" ? tankCents : shirtCents);

  function add() {
    if (!size) return;
    onAdd(garment, size, qty);
    setSize(null);
    setQty(1);
  }

  const styleBtn = (g: Garment, label: string) => (
    <button
      type="button"
      onClick={() => setGarment(g)}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium ${
        garment === g ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      <GarmentIcon garment={g} />
      <span>{label} <span className="text-xs font-normal text-slate-400">{formatCents(priceOf(g))}</span></span>
    </button>
  );

  const sizePill = (s: { key: SizeKey; short: string }) => (
    <button
      key={s.key}
      type="button"
      onClick={() => setSize(s.key)}
      className={`h-9 min-w-9 rounded-md border px-2 text-sm font-medium ${
        size === s.key ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {s.short}
    </button>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {multi && (
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium text-slate-800">Gear for {player.name}</span>
          {done ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">✓ added</span>
          ) : (
            <span className="text-xs font-medium text-amber-600">pick a size</span>
          )}
        </div>
      )}

      {/* Already added */}
      {lines.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 rounded-md bg-slate-50 ring-1 ring-slate-100">
          {lines.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
              <span className="text-slate-700">{l.quantity} × {garmentLabel(l.garment)} · {sizeLabel(l.size)}</span>
              <span className="flex items-center gap-3">
                <span className="text-slate-500">{formatCents(priceOf(l.garment) * l.quantity)}</span>
                <button type="button" onClick={() => onRemove(l)} className="text-xs text-slate-400 hover:text-rose-600">Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Builder */}
      <div className="flex gap-2">{styleBtn("SHIRT", "T-shirt")}{styleBtn("TANK", "Tank top")}</div>

      <div className="mt-3">
        <div className="text-xs font-medium text-slate-500">Size</div>
        <div className="mt-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 text-xs text-slate-400">Youth</span>
            {YOUTH.map(sizePill)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 text-xs text-slate-400">Adult</span>
            {ADULT.map(sizePill)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Qty</span>
          <div className="inline-flex items-center rounded-md border border-slate-200">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-2.5 py-1 text-slate-500 hover:bg-slate-50" aria-label="Decrease">−</button>
            <span className="min-w-8 text-center text-sm">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} className="px-2.5 py-1 text-slate-500 hover:bg-slate-50" aria-label="Increase">+</button>
          </div>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!size}
          className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {size ? `Add ${garmentLabel(garment)} · ${sizeLabel(size)}` : "Pick a size"}
        </button>
      </div>
    </div>
  );
}

function SizeGuide() {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">Size guide</summary>
      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Youth</p>
        <p>S (6–8) · M (10–12) · L (14–16) · XL (18–20)</p>
        <p className="mt-2 font-medium text-slate-700">Adult (unisex)</p>
        <p>XS · S · M · L · XL · 2XL</p>
        <p className="mt-2 text-slate-400">Shirts run true to size. When between sizes, size up.</p>
      </div>
    </details>
  );
}
