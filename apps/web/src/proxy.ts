import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_HEADER, negotiate } from "@/i18n";

const SESSION_COOKIES = ["fk_session"];
const PROTECTED = ["/dashboard", "/onboarding", "/admin"];

/**
 * Runs before every page request:
 * 1. Resolves the UI locale (?lang= → cookie → Accept-Language → Arabic) and
 *    forwards it to server components via a request header.
 * 2. Cheap auth gate: protected areas require a session cookie (real
 *    verification happens server-side in layouts).
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const queryLang = url.searchParams.get("lang");
  const cookieLang = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(queryLang)
    ? queryLang
    : isLocale(cookieLang)
      ? cookieLang
      : (negotiate(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);

  const isProtected = PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  const hasSession =
    SESSION_COOKIES.some((c) => request.cookies.has(c)) || request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (isProtected && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", url.pathname + url.search);
    return NextResponse.redirect(login);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  requestHeaders.set("x-fk-pathname", url.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (isLocale(queryLang) && queryLang !== cookieLang) {
    response.cookies.set(LOCALE_COOKIE, queryLang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|js|css|txt)$).*)"],
};
