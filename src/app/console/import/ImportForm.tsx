// Plain native form POST to the import route handler — this carries the session
// cookie reliably on this deployment (a fetch upload did not). No client JS.
export function ImportForm({ ticket }: { ticket: string }) {
  return (
    <form
      method="POST"
      action="/api/console/import"
      encType="multipart/form-data"
      className="card space-y-4"
    >
      <input type="hidden" name="ticket" value={ticket} />
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
        <button type="submit" name="mode" value="preview" className="btn-secondary">Preview</button>
        <button type="submit" name="mode" value="commit" className="btn-primary">Import now</button>
      </div>
    </form>
  );
}
