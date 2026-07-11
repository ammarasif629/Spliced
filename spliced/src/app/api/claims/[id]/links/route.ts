import { NextRequest, NextResponse } from "next/server";
import { createLink } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";
import type { LinkKind } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const linkId = createLink(newsroomOf(req), {
      fromClaim: id,
      toClaim: body.to_claim,
      evidenceId: body.evidence_id,
      kind: body.kind as LinkKind,
    });
    return NextResponse.json({ id: linkId }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
