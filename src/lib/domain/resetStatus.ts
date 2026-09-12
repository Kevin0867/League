// Human-readable result of a "Text reset link" action, shared by every page
// that exposes the button (Access, Registrations, Teams).
export function RESET_STATUS(code: string | undefined, via?: string): { tone: "ok" | "err"; text: string } | null {
  if (!code) return null;
  switch (code) {
    case "sent":
      return { tone: "ok", text: via === "guardian" ? "Reset link sent to the parent/guardian by text and email." : "Reset link sent by text and email." };
    case "auth": return { tone: "err", text: "You don't have permission to send reset links." };
    case "notarget": return { tone: "err", text: "Couldn't tell who to send to." };
    case "no-account": return { tone: "err", text: "No login exists for this person yet — invite them first (they have no account to reset)." };
    case "inactive": return { tone: "err", text: "That login is disabled — enable it first, then send the link." };
    case "no-contact": return { tone: "err", text: "No email or phone on file for this person or their guardian — add contact info first." };
    case "not-found": return { tone: "err", text: "Couldn't find that person." };
    default: return null;
  }
}
