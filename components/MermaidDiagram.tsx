"use client";

import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        // htmlLabels:false keeps labels as native SVG <text> so the on-page
        // SVG can be rasterized to canvas (PPT export). <foreignObject>
        // labels cannot be drawn via <img> in Chromium.
        flowchart: { curve: "basis", padding: 12, htmlLabels: false }
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

let nextId = 0;

export function MermaidDiagram({ code, fallbackCode }: { code: string; fallbackCode?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!code) return;
    const id = `mmd-${++nextId}`;
    setError(null);
    setUsingFallback(false);
    setRendering(true);
    if (ref.current) ref.current.innerHTML = "";
    (async () => {
      try {
        const mermaid = await getMermaid();
        let svg: string;
        try {
          ({ svg } = await mermaid.render(id, code));
        } catch (renderError) {
          if (!fallbackCode?.trim() || fallbackCode === code) throw renderError;
          ({ svg } = await mermaid.render(`${id}-fallback`, fallbackCode));
          if (!cancelled) setUsingFallback(true);
        }
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to render diagram");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, fallbackCode]);

  if (error) {
    return (
      <div className="text-xs text-red-600">
        Diagram render error: {error}
      </div>
    );
  }
  return (
    <div className="relative min-h-[220px]">
      {usingFallback ? <p className="mb-2 text-xs text-amber-800">Showing the baseline service flow because the revised diagram could not be rendered.</p> : null}
      {rendering ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-gray-600">
          <span className="mr-2 h-5 w-5 rounded-full border-2 border-ms-blue border-t-transparent animate-spin" />
          Loading component flow...
        </div>
      ) : null}
      <div
        ref={ref}
        data-mermaid-host="true"
        data-mermaid-code={usingFallback ? fallbackCode : code}
        className="overflow-x-auto w-full [&_svg]:max-w-full [&_svg]:h-auto"
      />
    </div>
  );
}
