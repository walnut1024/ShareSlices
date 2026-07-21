import type { Context } from "hono";
import { errorJson } from "./http-error.js";

const versionPattern = /^\d+\.\d+\.\d+$/;
const supportedOperatingSystems = new Set(["linux", "macos", "windows"]);

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export function checkCliCompatibility(c: Context, minimumCliVersion: string) {
  const currentVersion = c.req.header("shareslices-cli-version") ?? "";
  const operatingSystem = c.req.header("shareslices-cli-os") ?? "";
  if (
    !versionPattern.test(currentVersion)
    || !supportedOperatingSystems.has(operatingSystem)
    || compareVersions(currentVersion, minimumCliVersion) < 0
  ) {
    return errorJson(c, 426, "cli_upgrade_required", undefined, {
      action: `Update ShareSlices CLI to ${minimumCliVersion} or newer.`,
      details: {
        currentVersion,
        minimumVersion: minimumCliVersion,
        operatingSystem,
        supportedOperatingSystems: [...supportedOperatingSystems],
      },
    });
  }
  return null;
}
