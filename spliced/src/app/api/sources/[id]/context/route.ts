import { NextRequest, NextResponse } from "next/server";
import { getSourceContext } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = getSourceContext(newsroomOf(req), id);
    if (!ctx) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(ctx);
  } catch (e) {
    return jsonError(e);
  }
}
