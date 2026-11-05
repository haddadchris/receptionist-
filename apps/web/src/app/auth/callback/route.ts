import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/adapter";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const result = await getAuth().completeCallback(params);
  if (!result) return NextResponse.redirect(new URL("/login?error=link", request.url));
  return NextResponse.redirect(new URL(safeNext, request.url));
}
