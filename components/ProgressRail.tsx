"use client";

import { DecisionInput } from "@/lib/types";
import { applicableWizardSteps, WizardStepId, WIZARD_VERSION } from "@/lib/wizard-steps";

export function ProgressRail({
  input,
  currentStepId
}: {
  input: DecisionInput;
  currentStepId?: WizardStepId;
}) {
  const steps = applicableWizardSteps(input);

  return (
    <nav className="card sticky top-3" aria-label="Profile progress">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          Profile progress
        </h3>
        <span className="badge badge-muted">v{WIZARD_VERSION}</span>
      </div>
      <ol className="mt-3 space-y-2 text-sm">
        {steps.map((step, index) => {
          const answered = step.questions.filter((question) => question.isAnswered && question.isAnswered(input)).length;
          const current = step.id === currentStepId;
          const complete = answered === step.questions.length;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              className={`rounded-md border px-2.5 py-2 ${
                current
                  ? "border-ms-blue bg-blue-50/50"
                  : complete
                  ? "border-ms-border bg-white"
                  : "border-ms-border bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    complete
                      ? "bg-ms-blue text-white"
                      : current
                      ? "bg-blue-100 text-ms-blue"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={current ? "font-semibold text-ms-blue" : "font-medium text-gray-800"}>
                  {step.shortTitle}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {answered}/{step.questions.length} answered
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {step.questions.slice(0, 3).map((question) => {
                  const done = question.isAnswered ? question.isAnswered(input) : false;
                  return (
                    <li key={question.id} className={`truncate text-xs ${done ? "text-gray-700" : "text-gray-400"}`}>
                      {question.title}
                    </li>
                  );
                })}
                {step.questions.length > 3 ? (
                  <li className="text-xs text-gray-400">+{step.questions.length - 3} more</li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
