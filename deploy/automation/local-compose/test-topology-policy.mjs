const allowedLoopbackHosts = new Set(["127.0.0.1", "::1"]);

function assertProjectResource(kind, logicalName, resource, project) {
  if (resource?.external === true || typeof resource?.external === "object") {
    throw new Error(`Test Compose ${kind} ${logicalName} must not be external`);
  }
  const expectedPrefix = `${project}_`;
  if (resource?.name && !resource.name.startsWith(expectedPrefix)) {
    throw new Error(
      `Test Compose ${kind} ${logicalName} escapes project ${project}: ${resource.name}`,
    );
  }
}

export function validateTestComposeModel(model, expectedProject = "shareslices-test") {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("Test Compose model must be an object");
  }
  if (model.name !== expectedProject) {
    throw new Error(`Test Compose project must be ${expectedProject}, received ${model.name}`);
  }
  if (!model.services || typeof model.services !== "object") {
    throw new Error("Test Compose model has no services");
  }

  for (const [serviceName, service] of Object.entries(model.services)) {
    if (service.container_name) {
      throw new Error(`Test Compose service ${serviceName} must not set container_name`);
    }
    for (const port of service.ports ?? []) {
      if (!allowedLoopbackHosts.has(port.host_ip)) {
        throw new Error(
          `Test Compose service ${serviceName} publishes ${port.target} outside loopback`,
        );
      }
    }
    for (const [kind, references] of [
      ["config", service.configs],
      ["secret", service.secrets],
    ]) {
      if (references?.length) {
        throw new Error(`Test Compose service ${serviceName} must not consume ${kind}s`);
      }
    }
  }

  for (const [kind, resources] of [
    ["network", model.networks],
    ["volume", model.volumes],
  ]) {
    for (const [logicalName, resource] of Object.entries(resources ?? {})) {
      assertProjectResource(kind, logicalName, resource, expectedProject);
    }
  }
  if (Object.keys(model.configs ?? {}).length > 0) {
    throw new Error("Test Compose model must not define configs");
  }
  if (Object.keys(model.secrets ?? {}).length > 0) {
    throw new Error("Test Compose model must not define secrets");
  }
  return model;
}

export function loadAndValidateTestComposeModel({
  connectionArgs,
  composeArgs,
  environment,
  executeCommand,
  expectedProject = "shareslices-test",
}) {
  const output = executeCommand(
    [...connectionArgs, ...composeArgs, "config", "--format", "json"],
    { env: environment },
  );
  let model;
  try {
    model = JSON.parse(output);
  } catch {
    throw new Error("Docker Compose returned an invalid JSON test model");
  }
  return validateTestComposeModel(model, expectedProject);
}
