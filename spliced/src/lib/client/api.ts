"use client";
import { useAppStore } from "./store";

// 모든 요청에 현재 뉴스룸을 붙인다 — 서버 DAL이 이 스코프를 강제한다
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { newsroomId, nickname } = useAppStore.getState();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(newsroomId ? { "x-newsroom-id": newsroomId } : {}),
      "x-actor": encodeURIComponent(nickname || "Anonymous"),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
