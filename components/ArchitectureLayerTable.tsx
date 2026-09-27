"use client";

import { ArchitectureLayer } from "@/lib/types";

export function ArchitectureLayerTable({ layers }: { layers: ArchitectureLayer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full rounded-md border border-gray-200 text-xs">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-2.5 py-2 font-medium">Layer</th>
            <th className="px-2.5 py-2 font-medium">Required</th>
            <th className="px-2.5 py-2 font-medium">Selections</th>
            <th className="px-2.5 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.layer} className="border-t border-gray-100 align-top">
              <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-gray-800">{l.layer}</td>
              <td className="px-2.5 py-1.5">
                <span className={`badge ${l.required ? "badge-info" : "badge-muted"}`}>
                  {l.required ? "Required" : "Optional"}
                </span>
              </td>
              <td className="px-2.5 py-1.5">
                <ul className="list-disc list-inside space-y-0.5">
                  {l.selections.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </td>
              <td className="px-2.5 py-1.5 text-gray-600">{l.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
