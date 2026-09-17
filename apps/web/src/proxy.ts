import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkAuthEnabled } from "@/lib/auth-mode";

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

export const proxy = clerkAuthEnabled
  ? clerkMiddleware(async (auth, request) => {
      const { userId } = await auth();
      return gate(request, Boolean(userId));
    })
  : (request: NextRequest) => gate(request, hasLegacyToken(request));

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons).*)",
    "/__clerk/:path*",
  ],
};
