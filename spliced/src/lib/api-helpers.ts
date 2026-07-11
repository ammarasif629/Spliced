import { NextRequest, NextResponse } from "next/server";
import { listNewsrooms } from "./db/dal";

/**
 * tenant 스코프: 클라이언트가 x-newsroom-id 헤더로 현재 뉴스룸을 지정한다.
 * (프로덕션 문서에서는 세션에서 주입 — MVP에서는 헤더 + DAL 강제 스코프로 대체)
 */
export function newsroomOf(req: NextRequest): string {
  const h = req.headers.get("x-newsroom-id");
  if (h) return h;
  const all = listNewsrooms() as { id: string }[];
  if (all.length === 0) throw new Error("no newsroom");
  return all[0].id;
}

export function jsonError(err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}
