import { createLogRecord, type LogRecord, type LogRecordInput, type SeverityText } from "./log-record";

export * from "./log-record";

type BrowserConsole = Pick<Console, "debug" | "info" | "warn" | "error">;

export type WebLogger = {
  emit(input: LogRecordInput): void;
};

type WebLoggerOptions = {
  serviceVersion: string;
  deploymentEnvironment: string;
  console?: BrowserConsole;
  now?: () => Date;
};

function emitToConsole(browserConsole: BrowserConsole, severity: SeverityText, record: LogRecord): void {
  if (severity === "TRACE" || severity === "DEBUG") {
    browserConsole.debug(record);
  } else if (severity === "INFO") {
    browserConsole.info(record);
  } else if (severity === "WARN") {
    browserConsole.warn(record);
  } else {
    browserConsole.error(record);
  }
}

export function createWebLogger(options: WebLoggerOptions): WebLogger {
  const browserConsole = options.console ?? console;

  return {
    emit(input) {
      const record = createLogRecord(
        input,
        {
          serviceName: "shareslices-web",
          serviceVersion: options.serviceVersion,
          deploymentEnvironment: options.deploymentEnvironment
        },
        options.now
      );
      emitToConsole(browserConsole, input.severity, record);
    }
  };
}
