// Small color swatch for a team's assigned color — the visual identifier that
// goes with the color in the team's name (e.g. "PURE Mesa W3.0 Blue").
const COLOR_HEX: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  white: "#f8fafc",
  black: "#1e293b",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
};

export function teamColorHex(color: string | null | undefined): string {
  return COLOR_HEX[(color ?? "").toLowerCase()] ?? "#e2e8f0";
}

export function TeamColorDot({
  color,
  size = 12,
  className = "",
}: {
  color: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!color) return null;
  return (
    <span
      title={color}
      aria-label={`Team color: ${color}`}
      className={`inline-block shrink-0 rounded-full ring-1 ring-inset ring-slate-300 ${className}`}
      style={{ width: size, height: size, backgroundColor: teamColorHex(color) }}
    />
  );
}
