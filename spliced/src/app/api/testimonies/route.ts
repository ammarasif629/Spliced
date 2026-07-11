import { NextRequest, NextResponse } from "next/server";
import { createTestimony, listTestimonies } from "@/lib/db/dal";
import { analyzeTestimony } from "@/lib/llm/pipeline";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export function GET(req: NextRequest) {
  try {
    return NextResponse.json(listTestimonies(newsroomOf(req)));
  } catch (e) {
    return jsonError(e);
  }
}

// 원문 제출 → 202 (분석은 비동기 — 클라이언트는 analysis_status를 폴링)
export async function POST(req: NextRequest) {
  try {
    const nr = newsroomOf(req);
    const body = await req.json();
    const id = createTestimony(nr, {
      sourceId: body.source_id,
      newSourceName: body.new_source_name,
      newSourceRole: body.new_source_role,
      rawText: body.raw_text,
      givenAt: body.given_at,
    });
    // fire-and-forget: Celery 큐 대체 (단일 프로세스 MVP)
    // analyzeTestimony는 끝나면서 뉴스룸 전체 충돌 분석을 다시 돌린다
    void analyzeTestimony(nr, id);
    return NextResponse.json({ id, analysis: "queued" }, { status: 202 });
  } catch (e) {
    return jsonError(e);
  }
}
