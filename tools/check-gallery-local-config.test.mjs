import assert from "node:assert/strict";
import test from "node:test";
import { validateGalleryLocalConfiguration } from "./check-gallery-local-config.mjs";

function configuration(overrides = {}) {
  const environment = {
    WEB_ORIGIN: "http://app.localhost:5173",
    BETTER_AUTH_URL: "http://app.localhost:5173",
  };
  return {
    services: {
      api: { environment },
      migrate: { environment: { WEB_ORIGIN: environment.WEB_ORIGIN } },
      "gallery-content": { environment: { WEB_ORIGIN: environment.WEB_ORIGIN } },
      web: {
        environment: {
          WEB_ORIGIN: environment.WEB_ORIGIN,
          WEB_CANONICAL_HOST: "app.localhost",
        },
      },
      ...overrides,
    },
  };
}

test("accepts one canonical Gallery local Web endpoint", () => {
  assert.deepEqual(validateGalleryLocalConfiguration(configuration()), {
    origin: "http://app.localhost:5173",
    host: "app.localhost",
  });
});

test("rejects a Web origin that differs from the API", () => {
  assert.throws(
    () =>
      validateGalleryLocalConfiguration(
        configuration({
          web: {
            environment: {
              WEB_ORIGIN: "http://127.0.0.1:5173",
              WEB_CANONICAL_HOST: "127.0.0.1",
            },
          },
        }),
      ),
    /web WEB_ORIGIN must match API WEB_ORIGIN/,
  );
});

test("rejects a canonical host that differs from WEB_ORIGIN", () => {
  const value = configuration();
  value.services.web.environment.WEB_CANONICAL_HOST = "127.0.0.1";
  assert.throws(
    () => validateGalleryLocalConfiguration(value),
    /WEB_CANONICAL_HOST must equal WEB_ORIGIN hostname/,
  );
});
