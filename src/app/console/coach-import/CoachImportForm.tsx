// Native multipart form POST to the coach-import route (carries the session
// cookie reliably on this deployment; a fetch upload did not). Accepts either a
// CSV file or pasted rows. Preview renders on the next screen.
export function CoachImportForm({ ticket }: { ticket: string }) {
  return (
    <form method="POST" action="/api/console/coach-import" encType="multipart/form-data" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="mode" value="preview" />

      <div>
        <label className="label" htmlFor="file">Coaches CSV</label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-900"
        />
        <p className="mt-1 text-xs text-slate-500">Export your spreadsheet as CSV, with the column headings in the first row.</p>
      </div>

      <div>
        <label className="label" htmlFor="text">…or paste the rows</label>
        <textarea
          id="text"
          name="text"
          rows={4}
          placeholder="Paste the sheet including the header row (tab- or comma-separated)…"
          className="input font-mono text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="createLogins" defaultChecked /> Also create a login for each coach
      </label>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary">Preview import</button>
      </div>
    </form>
  );
}
