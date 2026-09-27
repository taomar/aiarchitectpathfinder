import Link from "next/link";
import { currentAdminUser } from "@/lib/admin-auth";
import { getUsageSummary } from "@/lib/usage-store";

function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-lg border border-ms-border bg-white p-3 shadow-card">
      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ms-text">{value}</div>
      {note ? <div className="mt-1 text-xs text-gray-500">{note}</div> : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">{message}</p>;
}

export default async function AdminPage() {
  const admin = await currentAdminUser();
  if (!admin) {
    return (
      <main className="layout-shell-narrow px-3 py-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
          <h1 className="text-lg font-semibold">Admin access only</h1>
          <p className="mt-2 text-sm">You are signed in, but this dashboard is restricted to configured administrators.</p>
        </div>
      </main>
    );
  }

  const summary = await getUsageSummary(30);
  const maxCreated = Math.max(...summary.daily.map((day) => day.architectureCreated), 1);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F4F8FC_0%,#FAFAFA_36%,#FFFFFF_100%)] px-3 py-4">
      <div className="layout-shell-wide space-y-4">
        <section className="rounded-xl border border-[#D6E3F3] bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-ms-blue font-semibold">Admin dashboard</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#1B1A19]">Architecture usage reporting</h1>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-600">
                Tracks architecture sessions from start, first recommendation output, subsequent modifications, diagram generation, and exports.
              </p>
            </div>
            <div className="text-right text-xs text-gray-500">
              <div>Admin: <span className="font-semibold text-gray-700">{admin.email}</span></div>
              <div>Generated: {new Date(summary.generatedAt).toLocaleString()}</div>
              <Link href="/" className="mt-2 inline-flex text-ms-blue underline">Back to Pathfinder</Link>
            </div>
          </div>
          {!summary.configured ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {summary.message || "Cosmos DB usage history is not configured yet. The dashboard is available, but historical metrics will appear after Azure settings are connected."}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
          <StatCard label="Architecture sessions" value={summary.totals.architectureSessions} note="Sessions with at least one final output" />
          <StatCard label="Architectures created" value={summary.totals.architectureCreated} note="First output per session" />
          <StatCard label="Architecture modifications" value={summary.totals.architectureModified} note="Refinements, edits, or changed outputs" />
          <StatCard label="Unique users" value={summary.totals.uniqueUsers} note="Hashed user identities" />
          <StatCard label="Started sessions" value={summary.totals.sessionsStarted} note="Create, example, direct text, or restart flows" />
          <StatCard label="Diagrams generated" value={summary.totals.diagramGenerated} note="Generate architecture clicks" />
          <StatCard label="PowerPoint exports" value={summary.totals.exports} note="Downloaded recommendation decks" />
          <StatCard label="Tracked events" value={summary.totals.totalEvents} note={`Last ${summary.rangeDays} days`} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Daily usage</h2>
            <p className="mt-1 text-sm text-gray-500">Created architectures and modifications by day.</p>
            {summary.daily.length === 0 ? (
              <div className="mt-4"><EmptyState message="No daily usage events recorded yet." /></div>
            ) : (
              <div className="mt-4 space-y-3">
                {summary.daily.map((day) => (
                  <div key={day.day} className="grid gap-2 md:grid-cols-[120px_1fr_180px] md:items-center">
                    <div className="text-sm font-medium text-gray-700">{day.day}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-ms-blue"
                        style={{ width: `${Math.max(6, (day.architectureCreated / maxCreated) * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-600">
                      {day.architectureCreated} created · {day.architectureModified} modified · {day.uniqueUsers} users
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Insights</h2>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {summary.insights.map((insight) => (
                <li key={insight} className="rounded-lg border border-ms-border bg-[#FAFBFC] px-3 py-2">{insight}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Session source</h2>
            {summary.bySource.length === 0 ? (
              <div className="mt-4"><EmptyState message="No session source data recorded yet." /></div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-gray-500">
                    <tr><th className="py-2">Source</th><th>Sessions</th><th>Architectures</th></tr>
                  </thead>
                  <tbody>
                    {summary.bySource.map((row) => (
                      <tr key={row.source} className="border-t border-ms-border">
                        <td className="py-2 font-medium">{row.source}</td>
                        <td>{row.sessions}</td>
                        <td>{row.architectures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Solution mix</h2>
            {summary.bySolutionType.length === 0 ? (
              <div className="mt-4"><EmptyState message="No completed architectures recorded yet." /></div>
            ) : (
              <div className="mt-4 space-y-2">
                {summary.bySolutionType.map((row) => (
                  <div key={row.solutionType} className="flex items-center justify-between rounded-lg border border-ms-border bg-[#FAFBFC] px-3 py-2 text-sm">
                    <span className="font-medium">{row.solutionType}</span>
                    <span className="badge badge-info">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Confidence mix</h2>
            <p className="mt-1 text-sm text-gray-500">Confidence of completed recommendations.</p>
            {summary.byConfidence.length === 0 ? (
              <div className="mt-4"><EmptyState message="No completed architectures recorded yet." /></div>
            ) : (
              <div className="mt-4 space-y-2">
                {summary.byConfidence.map((row) => (
                  <div key={row.confidence} className="flex items-center justify-between rounded-lg border border-ms-border bg-[#FAFBFC] px-3 py-2 text-sm">
                    <span className="font-medium capitalize">{row.confidence}</span>
                    <span className="badge badge-info">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold">Why low confidence</h2>
            <p className="mt-1 text-sm text-gray-500">Root cause for each low-confidence recommendation.</p>
            {summary.lowConfidenceReasons.length === 0 ? (
              <div className="mt-4"><EmptyState message="No low-confidence recommendations in this range." /></div>
            ) : (
              <div className="mt-4 space-y-2">
                {summary.lowConfidenceReasons.map((row) => (
                  <div key={row.reason} className="flex items-center justify-between gap-3 rounded-lg border border-ms-border bg-[#FAFBFC] px-3 py-2 text-sm">
                    <span className="font-medium">{row.reason}</span>
                    <span className="badge badge-warn shrink-0">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
          <h2 className="text-lg font-semibold">Usage by country</h2>
          <p className="mt-1 text-sm text-gray-500">Derived from request IP at event ingestion. Raw IP addresses are not stored.</p>
          {summary.byCountry.length === 0 ? (
            <div className="mt-4"><EmptyState message="No country-level usage data recorded yet." /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="py-2">Country</th>
                    <th>Sessions</th>
                    <th>Architectures</th>
                    <th>Unique users</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCountry.map((row) => (
                    <tr key={row.countryCode} className="border-t border-ms-border">
                      <td className="py-2 font-medium">{row.country} <span className="text-xs text-gray-400">{row.countryCode !== "ZZ" ? row.countryCode : ""}</span></td>
                      <td>{row.sessions}</td>
                      <td>{row.architectures}</td>
                      <td>{row.uniqueUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ms-border bg-white p-5 shadow-card">
          <h2 className="text-lg font-semibold">Recent architecture sessions</h2>
          <p className="mt-1 text-sm text-gray-500">Shows where the session came from and how many times the architecture output changed.</p>
          {summary.recentSessions.length === 0 ? (
            <div className="mt-4"><EmptyState message="No architecture sessions recorded yet." /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="py-2">Last seen</th>
                    <th>Source</th>
                    <th>Country</th>
                    <th>Solution</th>
                    <th>Pattern</th>
                    <th>Outputs</th>
                    <th>Modified</th>
                    <th>Confidence</th>
                    <th>Why low</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentSessions.map((session) => (
                    <tr key={session.sessionId} className="border-t border-ms-border align-top">
                      <td className="py-2 whitespace-nowrap">{new Date(session.lastSeen).toLocaleString()}</td>
                      <td>
                        <div className="font-medium">{session.source}</div>
                        {session.sourceDetail ? <div className="text-xs text-gray-500">{session.sourceDetail}</div> : null}
                      </td>
                      <td>{session.country || "Unknown"}</td>
                      <td>{session.solutionType || "-"}</td>
                      <td className="text-xs text-gray-600">{session.basePatternId || "-"}</td>
                      <td>{session.outputs}</td>
                      <td>{session.modifications}</td>
                      <td>{session.confidence || "-"}</td>
                      <td className="text-xs text-gray-600">
                        {session.confidence === "low"
                          ? session.lowConfidenceReason === "cross_family"
                            ? "Copilot vs Foundry tie-break"
                            : session.lowConfidenceReason === "missing_gate"
                            ? "Core question empty"
                            : session.lowConfidenceReason === "skipped_gates"
                            ? "Sections skipped"
                            : "-"
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
