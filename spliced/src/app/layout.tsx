import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { TopBar } from "@/components/shell/TopBar";

export const metadata: Metadata = {
  title: "SPLiCED",
  description:
    "Testimony is evidence, not truth — a corroboration-first collaborative platform for investigative journalism",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-screen flex-col overflow-hidden">
        <Providers>
          <TopBar />
          {/* navigation moved into the TopBar burger drawer — full-width content */}
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 overflow-auto">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
