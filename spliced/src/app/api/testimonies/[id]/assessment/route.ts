import { NextRequest, NextResponse } from "next/server";
import { getAssessment } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// DB 저장값이 아님 — 요청 시 corroboration 링크에서 파생(§4, §8)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const a = getAssessment(newsroomOf(req), id);
    if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(a);
  } catch (e) {
    return jsonError(e);
  }
}
