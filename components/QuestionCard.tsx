"use client";

import { useEffect, useId, useState } from "react";
import { WizardQuestion, DecisionInput } from "@/lib/types";
import { MultiSelectCard, OptionElimination } from "./MultiSelectCard";

export function QuestionCard({
  question,
  input,
  onChange,
  eliminations = [],
  filterLoading = false,
  variant = "card"
}: {
  question: WizardQuestion;
  input: DecisionInput;
  onChange: (next: DecisionInput) => void;
  eliminations?: OptionElimination[];
  filterLoading?: boolean;
  variant?: "card" | "section";
}) {
  const [showHelp, setShowHelp] = useState(false);
  const titleId = useId();
  const helpId = useId();
  const value = question.read ? question.read(input) : undefined;
  const apply = (v: any) => onChange(question.apply ? question.apply(input, v) : input);
  const elimMap = new Map(eliminations.map((e) => [e.id, e.reason]));

  // Local state for free-text inputs so typing never triggers a parent
  // re-render storm (which previously caused focus loss / perceived skip).
  // Commits to parent on blur and when the question changes.
  const [textDraft, setTextDraft] = useState<string>(
    question.type === "text" && typeof value === "string" ? value : ""
  );
  useEffect(() => {
    if (question.type === "text") {
      setTextDraft(typeof value === "string" ? value : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);
  const commitText = () => {
    if (question.type !== "text") return;
    if (textDraft !== value) apply(textDraft);
  };
  const textForShortcut = question.type === "text" ? textDraft.trim() : "";
  const updateDirectTextRecommendation = (checked: boolean) => {
    if (question.type === "text") {
      const withText = question.apply ? question.apply(input, textDraft) : input;
      onChange({ ...withText, directTextRecommendation: checked });
      return;
    }
    onChange({ ...input, directTextRecommendation: checked });
  };
  const showLayer = variant === "card";

  return (
    <section aria-labelledby={titleId} className={variant === "card" ? "card" : "border-t border-gray-200 pt-4 first:border-t-0 first:pt-0"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {showLayer ? (
            <div className="text-xs uppercase tracking-wider text-ms-blue font-semibold">
              {question.layer}
            </div>
          ) : null}
          <h2 id={titleId} className={variant === "card" ? "mt-1 text-lg font-semibold" : "text-sm font-semibold text-gray-900"}>
            {question.title}
          </h2>
        </div>
        {question.helperText ? (
          <button
            type="button"
            className="text-xs text-ms-blue underline shrink-0"
            onClick={() => setShowHelp((s) => !s)}
            aria-expanded={showHelp}
            aria-controls={showHelp ? helpId : undefined}
          >
            {showHelp ? "Hide" : "Why this matters"}
          </button>
        ) : null}
      </div>

      {showHelp && question.helperText ? (
        <p id={helpId} className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-600">
          {question.helperText}
        </p>
      ) : null}

      {filterLoading ? (
        <p className="mt-2 text-[11px] text-gray-500 italic">
          Narrowing this list based on your earlier answers…
        </p>
      ) : eliminations.length > 0 ? (
        <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
          {eliminations.length} option{eliminations.length === 1 ? "" : "s"} hidden or de-emphasized because they do not affect this route.
        </p>
      ) : null}

      <div className="mt-3">
        {question.type === "text" ? (
          <div className="space-y-2">
            <textarea
              aria-labelledby={titleId}
              aria-describedby={showHelp ? helpId : undefined}
              className="w-full rounded-md border border-gray-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ms-blue/40"
              rows={3}
              placeholder="Example: Employees ask sales questions in Teams using a Power BI semantic model."
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onBlur={commitText}
            />
            {question.id === "summary" ? (
              <label data-coach="wizard-buildtext" className="flex items-start gap-2 rounded-md border border-ms-border bg-gray-50 p-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-ms-blue focus:ring-ms-blue"
                  checked={!!input.directTextRecommendation}
                  onChange={(event) => updateDirectTextRecommendation(event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-gray-900">
                    Skip the wizard and build the recommendation from this text
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">
                    We&apos;ll read your description, fill in the details for you, and apply the same safety checks.
                  </span>
                  {input.directTextRecommendation && !textForShortcut ? (
                    <span className="mt-1 block text-xs text-amber-700">
                      Add a scenario above to use this shortcut.
                    </span>
                  ) : null}
                </span>
              </label>
            ) : null}
          </div>
        ) : question.type === "single" ? (
          <div className="flex flex-wrap gap-2">
            {(question.options ?? []).map((o) => {
              const active = value === o.id;
              const eliminated = elimMap.has(o.id) && !active;
              const reason = elimMap.get(o.id);
              if (eliminated) return null;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => apply(o.id)}
                  className={`choice ${active ? "choice-active" : ""} ${
                    ""
                  }`}
                  title={
                    eliminated ? `Not applicable: ${reason}` : undefined
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : question.type === "multi" ? (
          <MultiSelectCard
            options={question.options ?? []}
            selectedIds={Array.isArray(value) ? value : []}
            onChange={apply}
            allowUnknown={question.allowUnknown !== false}
            eliminations={eliminations}
          />
        ) : (
          <div className="text-sm text-gray-500">Unsupported question type.</div>
        )}
      </div>
    </section>
  );
}
