import { formatTime12 } from "@/lib/time";

// A friendly time picker: a 12-hour AM/PM dropdown (every 15 minutes by default)
// that still submits a 24-hour "HH:MM" value, so it's a drop-in for the native
// <input type="time"> the app used before — far easier to use on desktop, and it
// matches the academy's 12-hour clock. Works both uncontrolled (defaultValue, in
// a server-rendered form) and controlled (value + onChange, inside a client
// form). Any current value that falls off the grid is added so existing data is
// never lost.
function options(startHour: number, endHour: number, step: number, current?: string) {
  const opts: { value: string; label: string }[] = [];
  for (let m = startHour * 60; m <= endHour * 60; m += step) {
    const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    opts.push({ value: v, label: formatTime12(v) });
  }
  if (current && /^\d{2}:\d{2}$/.test(current) && !opts.some((o) => o.value === current)) {
    opts.push({ value: current, label: formatTime12(current) });
    opts.sort((a, b) => a.value.localeCompare(b.value));
  }
  return opts;
}

export function TimeSelect({
  name,
  id,
  defaultValue,
  value,
  onChange,
  className = "input",
  required = false,
  startHour = 6,
  endHour = 22,
  step = 15,
  placeholder = "—",
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
  required?: boolean;
  startHour?: number;
  endHour?: number;
  step?: number;
  placeholder?: string;
}) {
  const controlled = value !== undefined;
  const opts = options(startHour, endHour, step, controlled ? value : defaultValue);
  return (
    <select
      name={name}
      id={id}
      required={required}
      className={className}
      {...(controlled ? { value, onChange } : { defaultValue })}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
