import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuth } from "@/lib/auth/adapter";
import { BUSINESS_COOKIE, IMPERSONATE_COOKIE } from "@/lib/auth/current";

export async function POST(request: NextRequest) {
  await getAuth().signOut();
  const store = await cookies();
  store.delete(BUSINESS_COOKIE);
  store.delete(IMPERSONATE_COOKIE);
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
