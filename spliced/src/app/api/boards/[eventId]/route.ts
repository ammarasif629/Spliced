import { NextRequest, NextResponse } from "next/server";
import { createBoardObject, latestOpSeq, listBoardObjects } from "@/lib/db/boards";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

function actorOf(req: NextRequest): string {
  try {
    return decodeURIComponent(req.headers.get("x-actor") || "") || "Anonymous";
  } catch {
    return "Anonymous";
  }
}

// GET: board objects + latest op seq (폴링 동기화)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const nr = newsroomOf(req);
    return NextResponse.json({
      objects: listBoardObjects(nr, eventId),
      seq: latestOpSeq(nr, eventId),
    });
  } catch (e) {
    return jsonError(e);
  }
}

// POST: create object
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const body = await req.json();
    const id = createBoardObject(newsroomOf(req), eventId, actorOf(req), body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
