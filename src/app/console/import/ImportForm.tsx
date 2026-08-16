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
      {/* What a good file looks like — a downloadable template + the column
          spec, so you can see the shape before uploading rather than after a
          rejected file. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-700">Not sure of the format?</span>
          <a href="/templates/enrollment-template.csv" download className="btn-secondary py-1 text-xs">
            Download CSV template
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Columns (extra columns are ignored; only <span className="font-medium">First Name</span> + one of
          email/phone are required):
        </p>
        <ul className="mt-1.5 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <li><code>First Name</code>, <code>Last Name</code></li>
          <li><code>Email Address</code>, <code>Phone Number</code></li>
          <li><code>Program Names</code> — becomes the division</li>
          <li><code>Locations</code> — one or more, comma-separated</li>
          <li><code>DUPR</code>, <code>Date of Birth</code>, <code>Gender</code></li>
          <li><code>Parent First/Last Name</code>, <code>Parent Email Address</code></li>
          <li><code>Comments</code> — surfaced on the registration</li>
        </ul>
      </div>

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
          Existing people are matched on name + email/phone and merged — safe to re-run.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="preview" className="btn-secondary">Preview</button>
        <button type="submit" name="mode" value="commit" className="btn-primary">Import now</button>
      </div>
    </form>
  );
}
