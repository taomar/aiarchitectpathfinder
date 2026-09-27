export async function register() {
  // Keep the Node-only SDK out of both Edge and browser compilation branches.
  if (process.env.NEXT_RUNTIME === "nodejs" && typeof window === "undefined") {
    if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) return;

    try {
      const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
      useAzureMonitor({
        azureMonitorExporterOptions: {
          connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
        },
        instrumentationOptions: {
          http: { enabled: true },
          azureSdk: { enabled: true },
          mongoDb: { enabled: false },
          mySql: { enabled: false },
          postgreSql: { enabled: false },
          redis: { enabled: false },
          redis4: { enabled: false }
        }
      });
    } catch (err: any) {
      // Telemetry initialization must never crash server startup.
      console.error("[instrumentation] Azure Monitor init failed:", err?.message ?? err);
    }
  }
}
