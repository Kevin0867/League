"use client";

import { useState } from "react";

// Structured division picker for the ACP interest form: Adult/Youth → gender →
// skill level. Composes the choice into a hidden `likelyDivisions` field (e.g.
// "Men's 4.0", "Girls 3.5") so the backend keeps the same field it already reads.

const SKILLS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

export function AcpDivisionPicker() {
  const [category, setCategory] = useState("");
  const [gender, setGender] = useState("");
  const [skill, setSkill] = useState("");

  const genderOpts =
    category === "Adult" ? ["Men's", "Women's"] : category === "Youth" ? ["Boys", "Girls"] : [];

  function onCategory(c: string) {
    setCategory(c);
    const stillValid =
      (c === "Adult" && (gender === "Men's" || gender === "Women's")) ||
      (c === "Youth" && (gender === "Boys" || gender === "Girls"));
    if (!stillValid) setGender("");
  }

  const division = gender && skill ? `${gender} ${skill}` : "";

  return (
    <div className="space-y-4">
      {/* Carries the composed value to /api/acp/interest, unchanged field name. */}
      <input type="hidden" name="likelyDivisions" value={division} />

      <div>
        <label className="label">Adult or Youth?</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {["Adult", "Youth"].map((c) => (
            <Pill key={c} active={category === c} onClick={() => onCategory(c)}>{c}</Pill>
          ))}
        </div>
      </div>

      {category && (
        <div>
          <label className="label">{category === "Adult" ? "Men's or Women's?" : "Boys or Girls?"}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {genderOpts.map((g) => (
              <Pill key={g} active={gender === g} onClick={() => setGender(g)}>{g}</Pill>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label">Skill level</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {SKILLS.map((s) => (
            <Pill key={s} active={skill === s} onClick={() => setSkill(s)}>{s}</Pill>
          ))}
        </div>
      </div>

      {division && (
        <p className="text-sm text-slate-500">
          Division: <span className="font-semibold text-slate-800">{division}</span>
        </p>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}
