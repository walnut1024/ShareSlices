import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import type { ValidationNotice } from "../api/artifacts";

export function ArtifactValidationReport({
  notices,
  destructive = false
}: {
  notices: ValidationNotice[];
  destructive?: boolean;
}) {
  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {notices.map((notice, index) => (
        <Alert key={`${notice.code}-${index}`} variant={destructive ? "destructive" : "default"}>
          <AlertTitle>{notice.message}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {notice.action ? <p>{notice.action}</p> : null}
            <NoticeDetails notice={notice} />
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function NoticeDetails({ notice }: { notice: ValidationNotice }) {
  const { details } = notice;
  const values: Array<{ label: string; value: string }> = [];

  if (details.path) values.push({ label: "Path", value: details.path });
  if (details.extension) values.push({ label: "Extension", value: details.extension });
  if (details.validationKind) values.push({ label: "Expected format", value: details.validationKind });
  if (details.actualBytes !== undefined) values.push({ label: "Actual size", value: formatBytes(details.actualBytes) });
  if (details.limitBytes !== undefined) values.push({ label: "Allowed size", value: formatBytes(details.limitBytes) });
  if (details.actualCount !== undefined) values.push({ label: "Actual count", value: formatCount(details.actualCount) });
  if (details.limitCount !== undefined) values.push({ label: "Allowed count", value: formatCount(details.limitCount) });
  if (details.ignoredCount !== undefined) values.push({ label: "Ignored", value: `${formatCount(details.ignoredCount)} ignored` });
  if (details.directory) values.push({ label: "Directory", value: details.directory });
  if (details.entryFile) values.push({ label: "Entry file", value: details.entryFile });

  return (
    <>
      {values.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {values.map(({ label, value }) => (
            <div className="contents" key={label}>
              <dt>{label}</dt>
              <dd className="min-w-0 break-words font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <PathList label="Paths" paths={details.paths} />
      <PathList label="Candidates" paths={details.candidates} />
    </>
  );
}

function PathList({ label, paths }: { label: string; paths: string[] | undefined }) {
  if (!paths?.length) return null;
  return (
    <div>
      <p>{label}</p>
      <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
        {paths.map((path) => <li className="break-all" key={path}>{path}</li>)}
      </ul>
    </div>
  );
}

function formatBytes(bytes: number | string): string {
  if (typeof bytes === "string") return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${Number(value.toFixed(1))} ${unit}`;
}

function formatCount(count: number | string): string {
  return `${count} ${count === 1 || count === "1" ? "file" : "files"}`;
}
