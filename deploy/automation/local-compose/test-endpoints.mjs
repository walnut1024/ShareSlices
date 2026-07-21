const requiredBindings = Object.freeze({
  database: ["postgres", 5432],
  ingress: ["test-ingress", 8080],
  mailpit: ["mailpit", 8025],
  objectStorage: ["object-storage", 9000],
  smtp: ["mailpit", 1025],
});

const endpointLayerServices = Object.freeze([
  "mailpit",
  "object-storage",
  "postgres",
  "test-ingress",
]);

function bindingFor(records, service, targetPort) {
  const record = records.find((candidate) => candidate.Service === service);
  if (!record || record.State !== "running") {
    throw new Error(`Test endpoint service ${service} is not running`);
  }
  const matches = (record.Publishers ?? []).filter(
    (publisher) => Number(publisher.TargetPort) === targetPort,
  );
  if (matches.length !== 1) {
    throw new Error(`Test endpoint ${service}:${targetPort} has ${matches.length} bindings`);
  }
  const binding = matches[0];
  if (binding.URL !== "127.0.0.1" && binding.URL !== "::1") {
    throw new Error(`Test endpoint ${service}:${targetPort} is not caller-loopback-only`);
  }
  const port = Number(binding.PublishedPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Test endpoint ${service}:${targetPort} has invalid published port`);
  }
  return Object.freeze({ host: binding.URL, port });
}

export function freezeTestEndpoints(records) {
  const bindings = Object.fromEntries(
    Object.entries(requiredBindings).map(([name, [service, targetPort]]) => [
      name,
      bindingFor(records, service, targetPort),
    ]),
  );
  const assignedPorts = Object.values(bindings).map(({ port }) => port);
  if (new Set(assignedPorts).size !== assignedPorts.length) {
    throw new Error("Docker assigned one published port to multiple test endpoints");
  }
  const ingressPort = bindings.ingress.port;
  return Object.freeze({
    ...bindings,
    apiOrigin: `http://app.localhost:${ingressPort}`,
    apiTestOrigin: `http://api.localhost:${ingressPort}`,
    contentOrigin: `http://content.localhost:${ingressPort}`,
    webOrigin: `http://app.localhost:${ingressPort}`,
  });
}

export function freezeEndpointLayerIdentity(records) {
  return Object.freeze(Object.fromEntries(endpointLayerServices.map((service) => {
    const matches = records.filter((record) => record.Service === service);
    if (matches.length !== 1 || !matches[0].ID) {
      throw new Error(`Test endpoint layer requires exactly one identified ${service} container`);
    }
    return [service, matches[0].ID];
  })));
}

export function assertEndpointLayerUnchanged(beforeRecords, afterRecords) {
  const beforeIdentity = freezeEndpointLayerIdentity(beforeRecords);
  const afterIdentity = freezeEndpointLayerIdentity(afterRecords);
  for (const service of endpointLayerServices) {
    if (afterIdentity[service] !== beforeIdentity[service]) {
      throw new Error(`Test endpoint service ${service} was recreated during phase two`);
    }
  }

  const beforeEndpoints = freezeTestEndpoints(beforeRecords);
  const afterEndpoints = freezeTestEndpoints(afterRecords);
  for (const name of Object.keys(requiredBindings)) {
    if (
      beforeEndpoints[name].host !== afterEndpoints[name].host
      || beforeEndpoints[name].port !== afterEndpoints[name].port
    ) {
      throw new Error(`Test endpoint ${name} changed during phase two`);
    }
  }
}

export function runtimeEnvironmentContents(endpoints) {
  const values = {
    API_ORIGIN: endpoints.apiOrigin,
    BETTER_AUTH_URL: endpoints.webOrigin,
    GALLERY_CONTENT_ORIGIN: endpoints.contentOrigin,
    GALLERY_CONTENT_REGISTRABLE_SITE: "content.localhost",
    VIEWER_ORIGIN: endpoints.webOrigin,
    WEB_CANONICAL_HOST: "app.localhost",
    WEB_ORIGIN: endpoints.webOrigin,
  };
  return `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}
