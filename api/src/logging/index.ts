import { env } from "../env.js";
import { createLogRecord, type LogRecordInput, type SeverityText } from "./log-record.js";

export * from "./log-record.js";

type WriteLine = (line: string) => unknown;

export type ApiLogger = {
  emit(input: LogRecordInput): void;
};

type ApiLoggerOptions = {
  serviceVersion: string;
  deploymentEnvironment: string;
  stdout?: WriteLine;
  stderr?: WriteLine;
  now?: () => Date;
};

function streamFor(severity: SeverityText, stdout: WriteLine, stderr: WriteLine): WriteLine {
  return severity === "WARN" || severity === "ERROR" || severity === "FATAL" ? stderr : stdout;
}

export function createApiLogger(options: ApiLoggerOptions): ApiLogger {
  const stdout = options.stdout ?? ((line) => process.stdout.write(line));
  const stderr = options.stderr ?? ((line) => process.stderr.write(line));

  return {
    emit(input) {
      const record = createLogRecord(
        input,
        {
          serviceName: "shareslices-api",
          serviceVersion: options.serviceVersion,
          deploymentEnvironment: options.deploymentEnvironment
        },
        options.now
      );
      streamFor(input.severity, stdout, stderr)(`${JSON.stringify(record)}\n`);
    }
  };
}

export const apiLogger = createApiLogger({
  serviceVersion: "0.0.1",
  deploymentEnvironment: env.NODE_ENV
});
