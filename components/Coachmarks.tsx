"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";

export type CoachStep = {
  /** CSS selector for the element to spotlight, e.g. '[data-coach="cta"]'. */
  selector: string;
  title: string;
  body: string;
  /** Optional hook run just before this step is shown — e.g. switch to the right tab so
   *  the spotlighted element is mounted and visible before measuring. */
  onBeforeShow?: () => void;
};

/**
 * auto-show behavior:
 *  - "always": show on every mount unless the visitor unchecked "show each time"
 *              (landing page). Shows the "show each time" preference checkbox.
 *  - "once":   show only the first time this storageKey is seen, then never auto again
 *              (in-flow pages). The "How this works" button can always replay it.
 *  - "never":  only ever shown via the replay prop (button-triggered).
 */
type AutoShowMode = "always" | "once" | "never";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;

export function Coachmarks({
  steps,
  storageKey,
  replay = 0,
  autoShow = "always"
}: {
  steps: CoachStep[];
  storageKey: string;
  replay?: number;
  autoShow?: AutoShowMode;
}) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [showEachTime, setShowEachTime] = useState(true);
  const rafRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const seenKey = `${storageKey}:seen`;

  // Decide whether to auto-show on mount based on the mode + stored preferences.
  useEffect(() => {
    if (autoShow === "never") return;
    if (autoShow === "always") {
      let enabled = true;
      try {
        enabled = localStorage.getItem(storageKey) !== "0";
      } catch {
        /* ignore storage access errors */
      }
      setShowEachTime(enabled);
      if (enabled) {
        setStepIndex(0);
        setActive(true);
      }
      return;
    }
    // "once"
    let seen = false;
    try {
      seen = localStorage.getItem(seenKey) === "1";
    } catch {
      /* ignore */
    }
    if (!seen) {
      setStepIndex(0);
      setActive(true);
    }
  }, [storageKey, seenKey, autoShow]);

  // Re-trigger when the parent increments the replay counter ("How this works").
  useEffect(() => {
    if (replay > 0) {
      setStepIndex(0);
      setActive(true);
    }
  }, [replay]);

  const close = useCallback(() => {
    setActive(false);
    if (autoShow === "once") {
      try {
        localStorage.setItem(seenKey, "1");
      } catch {
        /* ignore */
      }
    }
  }, [autoShow, seenKey]);

  // Persist the "show each time" preference (only used in "always" mode).
  const updateShowEachTime = useCallback(
    (on: boolean) => {
      setShowEachTime(on);
      try {
        localStorage.setItem(storageKey, on ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );

  const measure = useCallback(() => {
    const step = steps[stepIndex];
    if (!step) return;
    const el = document.querySelector<HTMLElement>(step.selector);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [stepIndex, steps]);

  // Bring the current target into view (only if needed), then measure its position.
  useEffect(() => {
    if (!active) return;
    const step = steps[stepIndex];
    if (!step) return;
    // Let the step prepare the page (e.g. switch tabs) so its target is mounted first.
    step.onBeforeShow?.();
    const locate = () => {
      const el = document.querySelector<HTMLElement>(step.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const margin = 96; // keep room for the tooltip + avoid clipping headers
        const fullyVisible = r.top >= margin && r.bottom <= window.innerHeight - margin;
        if (!fullyVisible) {
          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
        }
      }
      measure();
    };
    // Wait one tick for any tab switch / scroll to settle before measuring.
    const id = window.setTimeout(locate, step.onBeforeShow ? 90 : 0);
    const id2 = window.setTimeout(measure, 360);
    // One more after smooth-scroll typically finishes, so the spotlight lands precisely.
    const id3 = window.setTimeout(measure, 720);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(id2);
      window.clearTimeout(id3);
    };
  }, [active, stepIndex, measure, steps]);

  // Keep the spotlight aligned on scroll / resize.
  useEffect(() => {
    if (!active) return;
    const onMove = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, measure]);

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of background) element.inert = true;
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);
    (focusableElements()[0] ?? dialog).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const controls = focusableElements();
      const first = controls[0] ?? dialog;
      const last = controls.at(-1) ?? dialog;
      if (!dialog.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const { element, inert } of background) element.inert = inert;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [active, close]);

  if (!active) return null;

  const isLast = stepIndex >= steps.length - 1;
  const step = steps[stepIndex];
  if (!step) return null;

  // Position the tooltip below the target if there's room, otherwise above.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const tipWidth = Math.min(320, viewportW - 32);
  let tipTop = 24;
  let tipLeft = 24;
  if (rect) {
    const below = rect.top + rect.height + PAD + 12;
    const wantAbove = below + 180 > viewportH;
    tipTop = wantAbove ? Math.max(16, rect.top - 188) : below;
    tipLeft = Math.min(Math.max(16, rect.left), viewportW - tipWidth - 16);
  }

  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      {rect ? (
        <div className="coach-catcher" onClick={close} />
      ) : (
        <div className="coach-backdrop" onClick={close} />
      )}

      {rect ? (
        <div
          className="coach-spotlight"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2
          }}
        />
      ) : null}

      <div className="coach-tip" style={{ top: tipTop, left: tipLeft, width: tipWidth }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-ms-blue">
            <Sparkles className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Step {stepIndex + 1} of {steps.length}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close walkthrough"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 id={titleId} className="mt-2 text-sm font-semibold leading-tight text-gray-950">{step.title}</h3>
        <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-gray-600">{step.body}</p>
        {autoShow === "always" ? (
          <label className="mt-3 flex cursor-pointer select-none items-center gap-2 rounded-md bg-[#F4F8FC] px-2.5 py-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={showEachTime}
              onChange={(e) => updateShowEachTime(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-ms-blue focus:ring-ms-blue"
            />
            Show this guide each time I open the page
          </label>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="text-xs font-medium text-gray-500 transition hover:text-gray-800"
          >
            {isLast ? "Close" : "Skip"}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? close() : setStepIndex((i) => i + 1))}
            className="inline-flex items-center gap-1.5 rounded-md bg-ms-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ms-blueDark focus:outline-none focus:ring-2 focus:ring-ms-blue focus:ring-offset-2"
          >
            {isLast ? "Got it" : "Next"}
            {isLast ? null : <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
