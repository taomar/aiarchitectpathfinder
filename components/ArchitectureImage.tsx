"use client";

import { useEffect, useMemo, useState } from "react";
import type { ArchitectureDecision, DecisionInput } from "@/lib/types";
import { buildArchitectureView } from "@/lib/architecture-view";
import { renderArchitectureViewSvg } from "@/lib/architecture-svg";

export { buildArchitectureSvg } from "@/lib/architecture-svg";

export function ArchitectureImage({
  decision, input, refreshNonce = 0, onGenerated, onError
}: {
  decision: ArchitectureDecision;
  input?: DecisionInput;
  autoGenerate?: boolean;
  refreshNonce?: number;
  onGenerated?: (dataUrl: string | null) => void;
  onError?: (message: string) => void;
}) {
  const model = useMemo(() => buildArchitectureView(decision, input), [decision, input]);
  const modelKey = JSON.stringify(model);
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconWarning, setIconWarning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setSvg(null);
    setUrl(null);
    setError(null);
    setIconWarning(false);
    onGenerated?.(null);
    void (async () => {
      try {
        const paths = [...new Set(model.layers.flatMap(layer => layer.nodes).flatMap(node => node.icon ? [node.icon] : []))];
        const entries = await Promise.all(paths.map(async path => {
          try {
            const response = await fetch(path, { signal: controller.signal });
            if (!response.ok) throw new Error(`Architecture icon unavailable (${response.status}).`);
            const content = await response.text();
            return [path, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`] as const;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            console.warn("[architecture] Icon unavailable; preserving its text label:", path);
            if (!cancelled) setIconWarning(true);
            return [path, null] as const;
          }
        }));
        const markup = renderArchitectureViewSvg(model, new Map(entries));
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        if (!cancelled) {
          setSvg(markup);
          setUrl(dataUrl);
          onGenerated?.(dataUrl);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Architecture rendering failed.";
        console.error("[architecture] Rendering failed:", message);
        setError(message);
        onError?.(message);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
    // The serialized model is the authoritative rendering input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, refreshNonce]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">One model for the page, SVG, and PowerPoint. Dashed items need confirmation.</p>
        {url && <a className="btn-outline" href={url} download={`architecture-${decision.basePatternId}.svg`}>Download SVG</a>}
      </div>
      {iconWarning && <p role="status" className="text-sm text-amber-800">Some icons could not load. All component names and boundaries are preserved.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!svg && !error && <p role="status" className="py-8 text-center text-sm text-slate-600">Preparing the shared architecture view…</p>}
      {svg && <div role="img" aria-label={`Architecture diagram for ${model.title}`} className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="min-w-[760px] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>}
    </div>
  );
}
