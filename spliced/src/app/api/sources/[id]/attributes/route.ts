import { NextRequest, NextResponse } from "next/server";
import { addSourceAttribute } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// 기자 입력 attribute — 출처 필수 권장, restricted면 legal_basis 요구(§4)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const aid = addSourceAttribute(newsroomOf(req), id, {
      category: body.category,
      statement: body.statement,
      citation_url: body.citation_url,
      citation_note: body.citation_note,
      is_allegation: body.is_allegation ?? true,
      restricted: body.restricted,
      legal_basis: body.legal_basis,
    });
    return NextResponse.json({ id: aid }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
