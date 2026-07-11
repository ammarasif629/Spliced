import { NextRequest, NextResponse } from "next/server";
import { setTestimonyStatus } from "@/lib/db/dal";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// 증언 기각 — 링크는 남지만 read-time 파생 집계에서 배제된다(§0.1)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const nr = newsroomOf(req);
    setTestimonyStatus(nr, id, "rejected");
    void reanalyzeConflicts(nr); // a rejected testimony is out of the conflict set
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
