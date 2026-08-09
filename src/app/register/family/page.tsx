import { redirect } from "next/navigation";

// The main enrollment form now handles families ("Myself and my child(ren)" —
// one waiver covers one adult and up to four kids), so this route just forwards.
export default function FamilyRegisterPage() {
  redirect("/register");
}
