import { NextRequest, NextResponse } from "next/server";
import { getTestimony, updateTestimony } from "@/lib/db/dal";
import { analyzeTestimony } from "@/lib/llm/pipeline";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const t = getTestimony(newsroomOf(req), id);
    if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(t);
  } catch (e) {
    return jsonError(e);
  }
}

// Edit the raw text and/or the date the testimony was given.
// Changing the text invalidates the extracted claims, so the full pipeline re-runs
// (which ends by re-running conflict analysis). Changing only the date keeps the
// claims but still re-runs conflict analysis — timing is a conflict dimension.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const nr = newsroomOf(req);
    const { id } = await params;
    const body = await req.json();
    const { textChanged, dateChanged } = updateTestimony(nr, id, {
      rawText: body.raw_text,
      givenAt: body.given_at === undefined ? undefined : body.given_at || null,
    });
    // Text edit ⇒ the pipeline re-extracts and ends by re-analyzing this testimony.
    // Date-only edit ⇒ the bulletins already moved page; re-analyze just this one,
    // since timing is a dimension the model reasons over.
    if (textChanged) void analyzeTestimony(nr, id);
    else if (dateChanged) void reanalyzeConflicts(nr, { focusTestimonyId: id });
    return NextResponse.json(
      { ok: true, reanalyzing: textChanged, moved: dateChanged },
      { status: textChanged ? 202 : 200 }
    );
  } catch (e) {
    return jsonError(e);
  }
}
