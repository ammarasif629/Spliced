import { NextRequest, NextResponse } from "next/server";
import { listSources } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export function GET(req: NextRequest) {
  try {
    return NextResponse.json(listSources(newsroomOf(req)));
  } catch (e) {
    return jsonError(e);
  }
}
