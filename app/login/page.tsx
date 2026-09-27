import { safeReturnPath } from "@/lib/app-auth";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-ms-border bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-ms-blue">Agentic AI Pathfinder</p>
        <h1 className="mt-3 text-2xl font-bold text-ms-text">Sign in to continue</h1>
        <p className="mt-3 text-sm text-gray-600">
          Enter the access password shared by the person hosting this application.
        </p>
        {params.error === "invalid" && (
          <p role="alert" className="mt-4 text-sm text-red-700">The password was not accepted. Please try again.</p>
        )}
        <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="next" value={safeReturnPath(params.next)} />
          <label htmlFor="password" className="block text-sm font-medium">Access password</label>
          <input
            id="password" name="password" type="password" required autoComplete="current-password"
            maxLength={1024} autoFocus
            className="w-full rounded-lg border border-ms-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ms-blue"
          />
          <button type="submit" className="w-full rounded-lg bg-ms-blue px-4 py-2 font-semibold text-white hover:opacity-90">
            Sign in
          </button>
        </form>
        <p className="mt-5 text-xs text-gray-500">Shared access does not grant administrator permissions.</p>
      </section>
    </main>
  );
}
