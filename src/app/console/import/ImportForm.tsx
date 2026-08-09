"use client";

import { useRef, useState } from "react";

type ImportState = {
  error?: string;
  preview?: {
    total: number;
    mapped: number;
    skipped: number;
    childCount: number;
    divisions: string[];
    markets: string[];
  };
  result?: {
    created: number;
    duplicates: number;
    errors: number;
    divisionsEnsured: number;
    seasonName: string;
    sampleErrors: string[];
  };
};

export function ImportForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ImportState>({});
  const [pending, setPending] = useState(false);

  // Post to the route handler (reliable cookie/session on this runtime).
  async function submit(mode: "preview" | "commit") {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("mode", mode);
    setPending(true);
    setState({});
    try {
      const res = await fetch("/api/console/import", { method: "POST", body: fd });
      const json = (await res.json()) as ImportState;
      setState(json);
    } catch {
      setState({ error: "Upload failed — please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="card space-y-4">
        <div>
          <label className="label" htmlFor="file">Enrollment CSV</label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-900"
          />
          <p className="mt-2 text-xs text-slate-500">
            The export with columns like First Name, Email Address, Program Names, Locations.
            Existing people are matched and merged — safe to re-run.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => submit("preview")} disabled={pending} className="btn-secondary">
            {pending ? "Reading…" : "Preview"}
          </button>
          <button type="button" onClick={() => submit("commit")} disabled={pending} className="btn-primary">
            {pending ? "Working…" : "Import now"}
          </button>
        </div>
      </form>

      {state?.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      )}

      {state?.preview && (
        <div className="card">
          <h3 className="font-semibold text-brand-900">Preview</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={state.preview.total} />
            <Stat label="Will import" value={state.preview.mapped} />
            <Stat label="Skipped" value={state.preview.skipped} />
            <Stat label="Youth (child)" value={state.preview.childCount} />
          </div>
          <p className="mt-4 text-sm text-slate-600">
            <span className="font-medium">{state.preview.divisions.length} divisions</span> will be
            created if missing: {state.preview.divisions.join(", ")}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium">Locations:</span> {state.preview.markets.join(", ")}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            Looks right? Click <span className="font-semibold">Import now</span> above.
          </p>
        </div>
      )}

      {state?.result && (
        <div className="card border-l-4 border-accent-500">
          <h3 className="font-semibold text-brand-900">Import complete</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={state.result.created} />
            <Stat label="Duplicates merged" value={state.result.duplicates} />
            <Stat label="Divisions added" value={state.result.divisionsEnsured} />
            <Stat label="Errors" value={state.result.errors} />
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Imported into <span className="font-medium">{state.result.seasonName}</span>. Head to{" "}
            <a href="/console/registrations" className="text-accent-700 underline">Registrations</a> or{" "}
            <a href="/console/pools" className="text-accent-700 underline">Assignment</a> to start placing players.
          </p>
          {state.result.sampleErrors.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-rose-600">
              {state.result.sampleErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <div className="text-2xl font-extrabold text-brand-900">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
