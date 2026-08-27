import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Legacy auth pages (HS256 + bcrypt) and Clerk's own hosted pages. Both are
// reachable while the two auth paths coexist.
const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/sign-in",
  "/sign-up",
];

// Clerk's auto-proxy path. `clerk init` could not compose this file
// automatically ("existing middleware uses an unsupported shape"), so the
// handoff is wired by hand below. These requests must never be redirected:
// bouncing Clerk's own callback to /login breaks the sign-in flow entirely.
const CLERK_INTERNAL_PREFIX = "/__clerk";

/**
 * The route gate, shared by both auth paths.
 *
 * `authenticated` is true when the caller holds EITHER the legacy `auth_token`
 * cookie (written by store/auth.ts after a bcrypt login) OR a live Clerk
 * session. Requiring both would lock out every existing user the moment Clerk
 * is enabled; requiring only Clerk would do the same before cutover.
 */
function gate(request: NextRequest, authenticated: boolean) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(CLERK_INTERNAL_PREFIX)) {
    return NextResponse.next();
  }

  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname.startsWith(route)
  );

  // Redirect unauthenticated users to login
  if (!authenticated && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (authenticated && isPublicRoute) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  return NextResponse.next();
}

function hasLegacyToken(request: NextRequest) {
  return Boolean(request.cookies.get("auth_token")?.value);
}

// Clerk is opt-in, mirroring the server: internal/config/clerk.go defaults
// CLERK_ENABLED to false and the Go API keeps HS256 as the default path. If the
// publishable key is absent, clerkMiddleware would throw at request time, so a
// checkout without Clerk keys runs the legacy gate unchanged.
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const proxy = clerkEnabled
  ? clerkMiddleware(async (auth, request) => {
      const { userId } = await auth();
      return gate(request, Boolean(userId) || hasLegacyToken(request));
    })
  : (request: NextRequest) => gate(request, hasLegacyToken(request));

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons).*)",
    "/__clerk/:path*",
  ],
};
