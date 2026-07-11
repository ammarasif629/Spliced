import { NextRequest, NextResponse } from "next/server";
import { setTestimonyStatus } from "@/lib/db/dal";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const nr = newsroomOf(req);
    setTestimonyStatus(nr, id, "active");
    void reanalyzeConflicts(nr); // back in play — it may conflict again
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
