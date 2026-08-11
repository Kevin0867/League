// Consent language for email / SMS opt-in (TCPA + Twilio A2P 10DLC). Kept in one
// place so the /opt-in form, the registration form, and the stored consent
// record always use the exact same wording — the version pins it in the audit.

export const CONSENT_VERSION = "2026-08";

export const BUSINESS_NAME = "PURE Pickleball & Padel";

/** SMS opt-in language — includes business name, program description, "not a
 *  condition of purchase", rates/frequency, and STOP/HELP. */
export const SMS_CONSENT_TEXT =
  "By checking this box, I agree to receive recurring automated text messages " +
  "(season updates, schedules, practice reminders, and account notifications) from " +
  "PURE Pickleball & Padel at the mobile number I provided. Consent is not a condition " +
  "of purchase. Message and data rates may apply. Message frequency varies. Reply STOP " +
  "to unsubscribe, HELP for help.";

/** Email opt-in language. */
export const EMAIL_CONSENT_TEXT =
  "I agree to receive emails (updates, schedules, and occasional promotions) from " +
  "PURE Pickleball & Padel. I can unsubscribe at any time.";

/** The combined record stored when either box is checked. */
export function consentRecordText(emailOptIn: boolean, smsOptIn: boolean): string {
  const parts: string[] = [];
  if (emailOptIn) parts.push(`EMAIL: ${EMAIL_CONSENT_TEXT}`);
  if (smsOptIn) parts.push(`SMS: ${SMS_CONSENT_TEXT}`);
  return parts.join("\n\n");
}
