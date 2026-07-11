import { NextRequest, NextResponse } from "next/server";
import { updateBoardObject } from "@/lib/db/boards";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

function actorOf(req: NextRequest): string {
  try {
    return decodeURIComponent(req.headers.get("x-actor") || "") || "Anonymous";
  } catch {
    return "Anonymous";
  }
}

// PATCH: move / resize / recolor / edit data / soft-delete(deleted=1) / restore(deleted=0)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    updateBoardObject(newsroomOf(req), id, actorOf(req), body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
