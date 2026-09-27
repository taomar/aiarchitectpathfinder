import "./globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { appOrigin, authMode, hasAppAccess } from "@/lib/app-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agentic AI Pathfinder | Platform Architecture Tool",
  description:
    "Agentic AI Pathfinder maps your use case to the right Microsoft agent platform — deterministic, scenario-driven guidance for agents, guardrails, and architecture."
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const signedIn = authMode() !== "none" &&
    hasAppAccess(new Request(appOrigin(), { headers: requestHeaders }));
  return (
    <html lang="en">
      <body className="min-h-screen bg-ms-bg text-ms-text antialiased">
        <div className="min-h-screen flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="border-t border-ms-border bg-white px-4 py-3 text-center text-xs text-gray-500">
            <span className="font-semibold text-ms-text">Agentic AI Pathfinder</span> · Platform Architecture Tool · powered by GitHub Copilot
            {signedIn && (
              <form action="/api/auth/logout" method="post" className="mt-2">
                <button type="submit" className="underline hover:text-ms-text">Sign out</button>
              </form>
            )}
          </footer>
        </div>
      </body>
    </html>
  );
}
