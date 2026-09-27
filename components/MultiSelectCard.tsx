"use client";

import { QuestionOption } from "@/lib/types";

export type OptionElimination = { id: string; reason: string };

export function MultiSelectCard({
  options,
  selectedIds,
  onChange,
  allowUnknown = true,
  eliminations = []
}: {
  options: QuestionOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allowUnknown?: boolean;
  eliminations?: OptionElimination[];
}) {
  const elimMap = new Map(eliminations.map((e) => [e.id, e.reason]));
  const visibleOptions = options.filter((option) => {
    if (option.id === "unknown" && !allowUnknown) return false;
    const active = selectedIds.includes(option.id);
    const eliminated = elimMap.has(option.id) && !active;
    return !eliminated;
  });
  const shouldShowGroups = visibleOptions.some((option) => option.group);
  const groupedOptions = visibleOptions.reduce<Array<{ name: string; options: QuestionOption[] }>>((groups, option) => {
    const name = shouldShowGroups ? option.group ?? "Other" : "";
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.options.push(option);
    else groups.push({ name, options: [option] });
    return groups;
  }, []);
  const toggle = (id: string) => {
    if (id === "unknown") {
      onChange(selectedIds.includes("unknown") ? [] : ["unknown"]);
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds.filter((s) => s !== "unknown"), id];
    onChange(next);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {selectedIds.length === 0
            ? "No selections yet"
            : `${selectedIds.length} selected`}
        </div>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            className="text-xs text-ms-blue underline"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {groupedOptions.map((group) => (
          <div key={group.name || "options"}>
            {shouldShowGroups ? (
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {group.name}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {group.options.map((o) => {
          const active = selectedIds.includes(o.id);
          const eliminated = elimMap.has(o.id) && !active;
          const reason = elimMap.get(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className={`choice text-left ${active ? "choice-active" : ""} ${
                eliminated ? "opacity-50" : ""
              }`}
              aria-pressed={active}
              title={eliminated ? `Not applicable: ${reason}` : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                    active
                      ? "bg-ms-blue border-ms-blue text-white"
                      : "border-gray-300 bg-white"
                  }`}
                  aria-hidden
                >
                  {active ? "✓" : ""}
                </span>
                <span
                  className={`text-sm font-medium ${
                    eliminated ? "line-through text-gray-500" : ""
                  }`}
                >
                  {o.label}
                </span>
                {eliminated ? (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    Skip
                  </span>
                ) : null}
              </div>
              {o.description ? (
                <div className="ml-6 mt-0.5 text-xs leading-relaxed text-gray-500">{o.description}</div>
              ) : null}
              {eliminated && reason ? (
                <div className="ml-6 mt-1 text-[11px] text-amber-700">{reason}</div>
              ) : null}
            </button>
          );
        })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
