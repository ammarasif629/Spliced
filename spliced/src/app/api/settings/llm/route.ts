import { NextRequest, NextResponse } from "next/server";
import { llmStatus, saveLlmConfig } from "@/lib/llm/config";
import { reanalyzeConflicts } from "@/lib/llm/conflicts";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// The API key is write-only. GET reports whether one is configured, which model it
// points at, and the last four characters — never the key itself.
export function GET() {
  try {
    return NextResponse.json(llmStatus());
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const status = saveLlmConfig({
      apiKey: body.api_key,
      baseUrl: body.base_url,
      model: body.model,
    });
    // A different model (or the first key ever) can reach a different verdict on the
    // same testimonies, so the corpus cache must not shortcut the next run.
    if (status.configured) void reanalyzeConflicts(newsroomOf(req), { force: true });
    return NextResponse.json(status);
  } catch (e) {
    return jsonError(e);
  }
}
