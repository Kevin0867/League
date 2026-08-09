import { NextResponse } from "next/server";

// Clear the session cookie on the response itself so the deletion is reliably
// emitted (a next/headers mutation in a route handler isn't attached to the
// redirect response).
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set("pa_session", "", { path: "/", maxAge: 0 });
  return res;
}
