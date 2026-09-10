// Renders a message's photo/video attachment. Server-safe (no client hooks).
// A VIDEO shows an inline player with controls; anything else renders as an
// image. Used in DM threads, the coaches' lounge, and team announcements.
export function Attachment({ url, type }: { url?: string | null; type?: string | null }) {
  if (!url) return null;
  if (type === "VIDEO") {
    return <video src={url} controls preload="metadata" className="mt-2 max-h-96 w-full max-w-md rounded-lg ring-1 ring-slate-200" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="attachment" className="max-h-96 max-w-md rounded-lg ring-1 ring-slate-200" />
    </a>
  );
}
