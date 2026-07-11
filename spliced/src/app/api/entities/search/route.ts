import { NextRequest, NextResponse } from "next/server";
import { searchEntities } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json(searchEntities(newsroomOf(req), q));
  } catch (e) {
    return jsonError(e);
  }
}
