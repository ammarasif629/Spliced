import { NextRequest, NextResponse } from "next/server";
import { deleteEvent } from "@/lib/db/dal";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// 페이지(이벤트) 삭제 — 해당 페이지에 클레임을 올린 증언들을 클레임·링크와
// 함께 영구 삭제한다(고아 증언 없음). UI에서 사용자 확인 후에만 호출된다.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const nr = newsroomOf(req);
    deleteEvent(nr, id);
    void reanalyzeConflicts(nr); // deleted testimonies can no longer conflict
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
