const unavailable = (id, reasonCode) => ({ id, state: "unavailable", reasonCode });
const available = (id) => ({ id, state: "available" });

function hasEvidence(probe) {
  return probe?.passed === true && typeof probe.evidenceId === "string" && probe.evidenceId.length > 0;
}

function identityIsQualified(connection) {
  const explicitVerifyFull =
    connection?.tlsMode === "verify-full" &&
    typeof connection.caCertificateId === "string" &&
    connection.caCertificateId.length > 0;
  const qualifiedEquivalent =
    connection?.tlsMode === "qualified-equivalent" &&
    typeof connection.qualificationId === "string" &&
    connection.qualificationId.length > 0;
  return (
    (explicitVerifyFull || qualifiedEquivalent) &&
    hasEvidence(connection?.positiveRuntimeProbe) &&
    hasEvidence(connection?.negativeIdentityProbe)
  );
}

export function diagnoseCloudflareDatabase(observation) {
  const checks = [];
  const hyperdrive = observation?.hyperdrive;

  checks.push(
    hyperdrive?.reachable === true
      ? available("cloudflare-hyperdrive-reachable")
      : unavailable("cloudflare-hyperdrive-reachable", "cloudflare_hyperdrive_unreachable"),
  );
  checks.push(
    hyperdrive?.queryCacheDisabled === true
      ? available("cloudflare-hyperdrive-cache-disabled")
      : unavailable("cloudflare-hyperdrive-cache-disabled", "cloudflare_hyperdrive_cache_not_proven_disabled"),
  );
  checks.push(
    identityIsQualified(hyperdrive)
      ? available("cloudflare-hyperdrive-origin-identity")
      : unavailable("cloudflare-hyperdrive-origin-identity", "cloudflare_hyperdrive_origin_identity_unqualified"),
  );

  const requiredDirectRoles = observation?.requiredDirectRoles;
  const directConnections = observation?.directConnections;
  if (!Array.isArray(requiredDirectRoles) || requiredDirectRoles.length === 0) {
    checks.push(unavailable("cloudflare-direct-postgresql", "cloudflare_direct_postgresql_evidence_missing"));
    return checks;
  }

  for (const role of requiredDirectRoles) {
    const connection = Array.isArray(directConnections)
      ? directConnections.find((candidate) => candidate?.role === role)
      : undefined;
    checks.push(
      connection?.reachable === true && identityIsQualified(connection)
        ? available(`cloudflare-direct-postgresql:${role}`)
        : unavailable(
          `cloudflare-direct-postgresql:${role}`,
          "cloudflare_direct_postgresql_unqualified",
        ),
    );
  }
  return checks;
}
