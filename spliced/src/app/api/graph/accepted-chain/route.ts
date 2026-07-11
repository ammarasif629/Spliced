import { NextRequest, NextResponse } from "next/server";
import { acceptedChain } from "@/lib/db/dal";
import { jsonError, newsroomOf } from "@/lib/api-helpers";

// status=active만으로 재구성한 서사(§4)
export function GET(req: NextRequest) {
  try {
    return NextResponse.json(acceptedChain(newsroomOf(req)));
  } catch (e) {
    return jsonError(e);
  }
}
