import { NextRequest, NextResponse } from "next/server";
import { buildAnalysisDoc } from "@/lib/db/analysis";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

/** The stored conflict analysis — the same document the viewport renders from. */
export function GET(req: NextRequest) {
  try {
    return NextResponse.json(buildAnalysisDoc(newsroomOf(req)));
  } catch (e) {
    return jsonError(e);
  }
}

/** Force a full re-analysis, bypassing the corpus cache. */
export async function POST(req: NextRequest) {
  try {
    const result = await reanalyzeConflicts(newsroomOf(req), { force: true });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
