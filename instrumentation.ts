// Next.js OpenTelemetry instrumentation hook.
// Runs once per server process on startup (Node.js runtime only).
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");
  const { AnthropicInstrumentation } = await import(
    "@arizeai/openinference-instrumentation-anthropic"
  );
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  const anthropicInstrumentation = new AnthropicInstrumentation();
  anthropicInstrumentation.manuallyInstrument(Anthropic);

  const sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
    instrumentations: [anthropicInstrumentation]
  });

  sdk.start();
}
