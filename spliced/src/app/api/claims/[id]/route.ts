import { NextRequest, NextResponse } from "next/server";
import { deleteClaim } from "@/lib/db/dal";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// 불레틴(클레임) 삭제 — 링크와 함께 제거하고, 부모 증언에 남은 클레임이
// 없으면 증언도 함께 삭제한다. UI에서 사용자 확인 후에만 호출된다.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const nr = newsroomOf(req);
    const { testimonyId, testimonyDeleted } = deleteClaim(nr, id);
    // The deleted claim's own links are already gone. Re-judge the rest of its
    // testimony; if the testimony went with it, a full pass re-keys the analysis.
    void reanalyzeConflicts(
      nr,
      testimonyDeleted ? {} : { focusTestimonyId: testimonyId }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
