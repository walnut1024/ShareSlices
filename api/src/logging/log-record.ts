export const severityNumbers = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21
} as const;

export type SeverityText = keyof typeof severityNumbers;
export type LogAttributeValue = string | number | boolean | string[] | number[] | boolean[];
export type LogAttributes = Record<string, LogAttributeValue>;

export type TraceContext = {
  traceId: string;
  spanId: string;
};

export type LogRecordInput = {
  severity: SeverityText;
  body: string;
  eventName: string;
  attributes?: LogAttributes;
  trace?: TraceContext;
};

export type LogResource = {
  serviceName: "shareslices-api";
  serviceVersion: string;
  deploymentEnvironment: string;
};

export type LogRecord = {
  timestamp: string;
  severityText: SeverityText;
  severityNumber: (typeof severityNumbers)[SeverityText];
  body: string;
  eventName: string;
  traceId?: string;
  spanId?: string;
  resource: {
    "service.name": LogResource["serviceName"];
    "service.version": string;
    "deployment.environment.name": string;
  };
  attributes: LogAttributes;
};

export function createLogRecord(
  input: LogRecordInput,
  resource: LogResource,
  now: () => Date = () => new Date()
): LogRecord {
  return {
    timestamp: now().toISOString(),
    severityText: input.severity,
    severityNumber: severityNumbers[input.severity],
    body: input.body,
    eventName: input.eventName,
    ...(input.trace ? { traceId: input.trace.traceId, spanId: input.trace.spanId } : {}),
    resource: {
      "service.name": resource.serviceName,
      "service.version": resource.serviceVersion,
      "deployment.environment.name": resource.deploymentEnvironment
    },
    attributes: input.attributes ?? {}
  };
}

export function parseTraceParent(value: string | undefined): TraceContext | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(?!ff)([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value.trim());
  if (!match || /^0+$/.test(match[2] ?? "") || /^0+$/.test(match[3] ?? "")) {
    return undefined;
  }

  return { traceId: match[2] as string, spanId: match[3] as string };
}

function sanitizeText(value: string): string {
  return value
    .replace(/smtps?:\/\/[^\s]+/gi, "smtp://[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^;\s]+/gi, "Authorization: [REDACTED]")
    .replace(/\b(cookie|set-cookie)\s*[=:]\s*[^;\s]+/gi, "$1=[REDACTED]")
    .replace(/\b(password|token|secret|session)\s*=\s*[^;\s]+/gi, "$1=[REDACTED]")
    .replace(/\/a\/[^/\s?#]+/g, "/a/[REDACTED]");
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${sanitizeText(error.message)}`;
  }
  return `${typeof error}: ${sanitizeText(String(error))}`;
}

export function exceptionAttributes(error: unknown): LogAttributes {
  const type = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const attributes: LogAttributes = {
    "exception.type": type,
    "exception.message": sanitizeText(message)
  };

  if (error instanceof Error && error.stack) {
    attributes["exception.stacktrace"] = sanitizeText(error.stack);
  }

  const causes: string[] = [];
  const seen = new Set<unknown>([error]);
  let cause = error instanceof Error ? error.cause : undefined;
  while (cause !== undefined && causes.length < 5 && !seen.has(cause)) {
    seen.add(cause);
    causes.push(errorSummary(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  if (causes.length > 0) {
    attributes["exception.cause_chain"] = causes;
  }

  return attributes;
}
