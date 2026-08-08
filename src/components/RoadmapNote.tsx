export function RoadmapNote({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/50 p-5">
      <div className="mb-1 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
        <span className="rounded bg-brand-600 px-1.5 py-0.5 text-white">{phase}</span>
        On the roadmap
      </div>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {subtitle && <p className="text-slate-500">{subtitle}</p>}
    </div>
  );
}
