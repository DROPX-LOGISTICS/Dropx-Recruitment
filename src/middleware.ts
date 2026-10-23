import { NextRequest, NextResponse } from "next/server";
import { RECRUITMENT_SESSION_COOKIE } from "@/lib/recruitment-session-cookie";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path === "/mcp" || path.startsWith("/api/mcp/oauth/") || path.startsWith("/.well-known/")) {
    return NextResponse.next();
  }

  if (path === "/mcp/consent" || path.startsWith("/mcp/consent/")) {
    if (!request.cookies.get(RECRUITMENT_SESSION_COOKIE)?.value) {
      const login = request.nextUrl.clone();
      login.pathname = "/";
      login.searchParams.set("next", `${path}${request.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/mcp", "/mcp/:path*", "/api/mcp/:path*", "/.well-known/:path*"]
};
