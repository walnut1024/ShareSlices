import { createLogRecord, type LogRecordInput } from "../logging/log-record.js";

export function createCloudflareLogger(input: Readonly<{
  serviceVersion: string;
  deploymentEnvironment: string;
  write?: (line: string) => void;
}>) {
  const write = input.write ?? ((line: string) => console.log(line));
  return Object.freeze({
    emit(record: LogRecordInput): void {
      write(JSON.stringify(createLogRecord(record, {
        serviceName: "shareslices-api",
        serviceVersion: input.serviceVersion,
        deploymentEnvironment: input.deploymentEnvironment,
      })));
    },
  });
}
