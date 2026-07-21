export const lifecycleOperations = Object.freeze([
  "doctor",
  "render",
  "plan",
  "apply",
  "status",
  "verify",
  "rollback",
]);

export function bindTargetAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("Target Adapter must be an object.");
  }
  const facade = {};
  for (const operation of lifecycleOperations) {
    if (typeof adapter[operation] !== "function") {
      throw new TypeError(`Target Adapter is missing ${operation}().`);
    }
    facade[operation] = (request) => adapter[operation](request);
  }
  return Object.freeze(facade);
}

export function invokeTargetAdapter(adapter, operation, request) {
  if (!lifecycleOperations.includes(operation)) {
    throw new TypeError(`Unsupported deployment lifecycle operation: ${operation}.`);
  }
  return adapter[operation](request);
}
