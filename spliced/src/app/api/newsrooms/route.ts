import { NextResponse } from "next/server";
import { listNewsrooms } from "@/lib/db/dal";

export function GET() {
  return NextResponse.json(listNewsrooms());
}
