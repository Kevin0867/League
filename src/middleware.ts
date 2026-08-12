import { NextResponse, type NextRequest } from "next/server";
import { sessionRolesFromToken, SESSION_COOKIE } from "@/lib/access/edgeSession";
import { decideConsoleAccess } from "@/lib/access/policy";

// Edge route guard for the console. This is the single choke point that stops a
// COACH (or a logged-out user, or a player/parent) from opening admin-only
// console pages just by typing the URL — the per-page render guards are
// defense-in-depth, and API mutations keep their own capability checks.
//
// Only /console PAGE navigations are governed here. /api/* is intentionally
// excluded: those handlers authenticate via signed action tickets (the session
// cookie isn't always present on POST in this runtime), and each already checks
// can(actor.role, …) before mutating.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const roles = await sessionRolesFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  const decision = decideConsoleAccess(pathname, roles);
  if (decision === "allow") return NextResponse.next();

  const url = req.nextUrl.clone();
  if (decision === "toLogin") {
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
  } else if (decision === "toPortal") {
    url.pathname = "/portal";
    url.search = "";
  } else {
    // Coach reaching an admin-only page → their console home.
    url.pathname = "/console";
    url.search = "";
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Guard console page routes only (the bare /console dashboard and everything
  // under it). API routes and public pages are untouched.
  matcher: ["/console", "/console/:path*"],
};
