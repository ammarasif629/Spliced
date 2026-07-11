import { NextRequest, NextResponse } from "next/server";
import { listBoardOps } from "@/lib/db/boards";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// operation history (actor + action + timestamp)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    return NextResponse.json(listBoardOps(newsroomOf(req), eventId));
  } catch (e) {
    return jsonError(e);
  }
}
