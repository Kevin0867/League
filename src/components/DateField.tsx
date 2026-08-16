"use client";

import { useState } from "react";

// A native date input (so it keeps the browser's accessible calendar picker)
// with the resulting weekday shown underneath — the thing you actually want to
// confirm when scheduling ("is Oct 26 a Monday?"). Submits the same "YYYY-MM-DD"
// value. Works uncontrolled (defaultValue) or controlled (value + onChange).
function weekdayOf(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const d = new Date(`${v}T00:00:00`);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long" });
}

export function DateField({
  name,
  id,
  defaultValue,
  value,
  onChange,
  className = "input",
  required = false,
  min,
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  required?: boolean;
  min?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const cur = controlled ? value ?? "" : internal;
  const wd = weekdayOf(cur);
  return (
    <span className="block">
      <input
        type="date"
        name={name}
        id={id}
        required={required}
        min={min}
        className={className}
        {...(controlled
          ? { value, onChange }
          : { defaultValue, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInternal(e.target.value) })}
      />
      {wd && <span className="mt-0.5 block text-xs text-slate-400">{wd}</span>}
    </span>
  );
}
