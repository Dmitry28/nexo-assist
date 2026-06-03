/**
 * OpenTelemetry bootstrap. MUST be imported before any other module (see main.ts)
 * so auto-instrumentation can patch http/express/etc. as they load.
 *
 * Opt-in: tracing only starts when OTEL_EXPORTER_OTLP_ENDPOINT is set. The SDK reads
 * standard OTEL_* env vars natively (service name via OTEL_SERVICE_NAME, endpoint via
 * OTEL_EXPORTER_OTLP_ENDPOINT), so there's nothing to wire through ConfigService.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = (): void => {
    void sdk.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
