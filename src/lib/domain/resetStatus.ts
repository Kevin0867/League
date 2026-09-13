// Human-readable result of a "Text reset link" action, shared by every page
// that exposes the button (Access, Registrations, Teams).
export function RESET_STATUS(code: string | undefined, via?: string, created?: string): { tone: "ok" | "err"; text: string } | null {
  if (!code) return null;
  switch (code) {
    case "sent": {
      const toGuardian = via === "guardian";
      if (created) {
        return { tone: "ok", text: toGuardian
          ? "Created a portal login for the parent/guardian and sent a set-password link by text and email."
          : "Created their portal login and sent a set-password link by text and email." };
      }
      return { tone: "ok", text: toGuardian
        ? "Reset link sent to the parent/guardian by text and email."
        : "Reset link sent by text and email." };
    }
    case "auth": return { tone: "err", text: "You don't have permission to send reset links." };
    case "notarget": return { tone: "err", text: "Couldn't tell who to send to." };
    case "no-email": return { tone: "err", text: "No email on file for this person or their guardian — add an email so a portal login can be created." };
    case "no-account": return { tone: "err", text: "No login exists yet and no email to create one — add an email first." };
    case "inactive": return { tone: "err", text: "That login is disabled — enable it first, then send the link." };
    case "no-contact": return { tone: "err", text: "No email or phone on file for this person or their guardian — add contact info first." };
    case "not-found": return { tone: "err", text: "Couldn't find that person." };
    default: return null;
  }
}
