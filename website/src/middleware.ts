import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isDev = process.env.NODE_ENV === "development";

/** Routes only available in development */
const DEV_ONLY_PREFIXES = ["/branding"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isDev && DEV_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.rewrite(new URL("/404", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml|json)$).*)",
  ],
};
