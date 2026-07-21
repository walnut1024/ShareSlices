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

const developerDefaultPorts = Object.freeze(new Set([
  1025,
  5173,
  5432,
  7460,
  8025,
  9000,
]));

function requireHttpOrigin(name, value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/") {
    throw new Error(`Test ${name} must be a credential-free HTTP Origin`);
  }
  return url;
}

export function assertDistinctTestBrowserSites(endpoints) {
  const web = requireHttpOrigin("Web Origin", endpoints.webOrigin);
  const content = requireHttpOrigin("Untrusted-content Origin", endpoints.contentOrigin);
  if (web.origin === content.origin) {
    throw new Error("Test Web and Untrusted-content Origins must be distinct");
  }
  if (web.hostname === content.hostname) {
    throw new Error(
      "Test Web and Untrusted-content Origins must not use the same host on different ports",
    );
  }
  if (web.hostname !== "app.localhost" || content.hostname !== "content.localhost") {
    throw new Error(
      "Test Web and Untrusted-content Origins must use the isolated app.localhost and content.localhost browser sites",
    );
  }
  for (const [name, binding] of Object.entries(endpoints)) {
    if (
      binding
      && typeof binding === "object"
      && Number.isSafeInteger(binding.port)
      && developerDefaultPorts.has(binding.port)
    ) {
      throw new Error(`Test endpoint ${name} reused developer-default port ${binding.port}`);
    }
  }
}

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
  const endpoints = Object.freeze({
    ...bindings,
    apiOrigin: `http://app.localhost:${ingressPort}`,
    apiTestOrigin: `http://api.localhost:${ingressPort}`,
    contentOrigin: `http://content.localhost:${ingressPort}`,
    webOrigin: `http://app.localhost:${ingressPort}`,
  });
  assertDistinctTestBrowserSites(endpoints);
  return endpoints;
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
