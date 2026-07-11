"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/client/store";
import { SidebarNav } from "@/components/shell/SidebarNav";
import type { Newsroom } from "@/lib/types";
import { t } from "@/lib/i18n/en";

export function TopBar() {
  const { newsroomId, setNewsroom, nickname, setNickname } = useAppStore();
  // navigation lives in a burger drawer — keeps the whole width for content
  const [navOpen, setNavOpen] = useState(false);
  const { data: newsrooms } = useQuery<Newsroom[]>({
    queryKey: ["newsrooms"],
    queryFn: async () => (await fetch("/api/newsrooms")).json(),
  });

  useEffect(() => {
    if (!newsrooms?.length) return;
    // 저장된 뉴스룸 ID가 더 이상 존재하지 않으면(DB 재시드 등) 첫 뉴스룸으로 복구
    if (!newsroomId || !newsrooms.some((n) => n.id === newsroomId))
      setNewsroom(newsrooms[0].id);
  }, [newsroomId, newsrooms, setNewsroom]);

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border-dim bg-panel px-5">
      {/* burger menu — opens the navigation drawer */}
      <button
        onClick={() => setNavOpen((o) => !o)}
        title={t("nav.menu")}
        aria-label={t("nav.menu")}
        className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-base text-slate-600 shadow-sm hover:border-[#1971C2] hover:text-[#1971C2]"
      >
        ☰
      </button>
      {navOpen && (
        <>
          {/* backdrop: click anywhere outside to close */}
          <div
            className="fixed inset-0 top-14 z-40 bg-slate-900/10"
            onClick={() => setNavOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 top-14 z-50 flex shadow-2xl"
            onClick={() => setNavOpen(false)}
          >
            <SidebarNav />
          </div>
        </>
      )}
      {/* SPL i CED — the separator is a custom-drawn lowercase "i" (dot + stem),
          doubling as a colon-like divider and the brand's identity mark */}
      <span
        aria-label={t("app.name")}
        className="flex select-none items-center text-lg font-bold tracking-widest text-accent"
      >
        SPL
        <span aria-hidden className="mx-[5px] flex flex-col items-center pt-[3px]">
          <span className="mb-[2.5px] block h-[4px] w-[4px] rounded-full bg-[#343A40]" />
          <span className="block h-[11px] w-[3px] rounded-full bg-[#343A40]" />
        </span>
        CED
      </span>
      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-[#1971C2]">
        {t("top.case")}: Warehouse Fire
      </span>
      <div className="ml-auto flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("top.nickname")}:
          <input
            className="w-28 rounded border border-border-dim bg-background px-2 py-1 text-sm"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("top.newsroom")}:
          <select
            className="rounded border border-border-dim bg-background px-2 py-1 text-sm"
            value={newsroomId ?? ""}
            onChange={(e) => {
              setNewsroom(e.target.value);
              window.location.reload();
            }}
          >
            {(newsrooms ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
