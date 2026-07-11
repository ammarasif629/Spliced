import { NextRequest, NextResponse } from "next/server";
import { graphFull } from "@/lib/db/dal";
import { generateEventSubtitle } from "@/lib/llm/pipeline";
import { ensureAnalysisFresh } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export function GET(req: NextRequest) {
  try {
    const nr = newsroomOf(req);
    const payload = graphFull(nr);
    // lazy AI day-summary generation: fill in on a later poll (fire-and-forget)
    for (const p of payload.planes) {
      if (!p.ai_subtitle && payload.claims.some((c) => c.event_id === p.id))
        void generateEventSubtitle(nr, p.id);
    }
    // Self-healing analysis: if the stored verdict predates the current engine (an
    // API key was just added) or the claims moved on, re-run in the background. The
    // next poll of this endpoint serves the fresh conflicts. A no-op when current.
    void ensureAnalysisFresh(nr);
    return NextResponse.json(payload);
  } catch (e) {
    return jsonError(e);
  }
}
