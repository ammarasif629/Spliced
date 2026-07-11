"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n/en";

const NAV = [
  { href: "/graph", label: t("nav.timeGraph"), icon: "◈" },
  { href: "/testimonies", label: t("nav.testimonies"), icon: "❝" },
  { href: "/sources", label: t("nav.sources"), icon: "☷" },
  { href: "/chain", label: t("nav.acceptedChain"), icon: "⛓" },
  { href: "/settings", label: t("nav.settings"), icon: "⚙" },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-border-dim bg-panel p-3">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm transition ${
              active
                ? "bg-blue-50 text-[#1971C2]"
                : "text-muted hover:bg-slate-100 hover:text-foreground"
            }`}
          >
            <span className="mr-2">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto rounded border border-border-dim p-2 text-[10px] leading-relaxed text-muted">
        {t("nav.noScoresNote")}
      </div>
    </nav>
  );
}
