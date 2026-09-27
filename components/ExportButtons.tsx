"use client";

import { useState } from "react";
import { ArchitectureDecision, DecisionInput, TieBreakResponse } from "@/lib/types";
import { toJSON, toMarkdown } from "@/lib/export";

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons({
  input,
  decision,
  tieBreak,
  refinement
}: {
  input: DecisionInput;
  decision: ArchitectureDecision;
  tieBreak?: TieBreakResponse | null;
  refinement?: string;
}) {
  const [copied, setCopied] = useState(false);
  const md = toMarkdown(input, decision, tieBreak, refinement);
  const json = toJSON(input, decision, tieBreak, refinement);

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="btn-outline"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(md);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy as Markdown"}
      </button>
      <button
        className="btn-outline"
        type="button"
        onClick={() => download("ai-platform-decision.md", md, "text/markdown")}
      >
        Export Markdown
      </button>
      <button
        className="btn-outline"
        type="button"
        onClick={() => download("ai-platform-decision.json", json, "application/json")}
      >
        Export JSON
      </button>
    </div>
  );
}
