import { APPAREL_GARMENTS, APPAREL_SIZES, garmentLabel, sizeLabel } from "@/lib/domain/apparel";

// Inline "fix a wrong apparel pick" control — garment (T-shirt/tank), size
// (youth vs adult), quantity. A plain form POST to the apparel route, so it
// drops into any server-rendered list (the fulfillment report, a player record).
export function ApparelItemEditor({
  ticket,
  item,
  returnTo,
  paid,
}: {
  ticket: string;
  item: { id: string; garment: string; size: string; quantity: number };
  returnTo: string;
  paid: boolean;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-slate-700 hover:text-brand-700" title="Change garment or size">
        {item.quantity}× {garmentLabel(item.garment)} · {sizeLabel(item.size)}
        {paid ? null : <span className="ml-1 text-xs text-amber-600">(unpaid)</span>}
      </summary>
      <form method="POST" action="/api/console/apparel" className="mt-1.5 flex flex-wrap items-end gap-1.5">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="editItem" />
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <select name="garment" defaultValue={item.garment} className="input py-1 text-xs">
          {APPAREL_GARMENTS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select name="size" defaultValue={item.size} className="input py-1 text-xs">
          <optgroup label="Youth">{APPAREL_SIZES.filter((s) => s.key.startsWith("Y")).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
          <optgroup label="Adult">{APPAREL_SIZES.filter((s) => s.key.startsWith("A")).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
        </select>
        <input name="quantity" type="number" min={1} max={20} defaultValue={item.quantity} className="input w-14 py-1 text-xs" />
        <button className="btn-secondary py-1 text-xs">Save</button>
      </form>
    </details>
  );
}
