export type VersionedAuthSecret = Readonly<{
  version: number;
  value: string;
}>;

export function parseVersionedAuthSecrets(value: string): VersionedAuthSecret[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid_better_auth_secrets");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("invalid_better_auth_secrets");
  }
  const versions = new Set<number>();
  const secrets = parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isSafeInteger((entry as { version?: unknown }).version) ||
      Number((entry as { version: number }).version) <= 0 ||
      typeof (entry as { value?: unknown }).value !== "string" ||
      (entry as { value: string }).value.length < 32
    ) {
      throw new Error("invalid_better_auth_secrets");
    }
    const secret = entry as { version: number; value: string };
    if (versions.has(secret.version)) {
      throw new Error("invalid_better_auth_secrets");
    }
    versions.add(secret.version);
    return { version: secret.version, value: secret.value };
  });
  return secrets;
}
