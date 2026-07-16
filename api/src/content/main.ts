import { serve } from "@hono/node-server";
import { galleryConfigurationFromEnv } from "../application/gallery/configuration.js";
import { PostgresAdministratorReviewCredentialValidator, PostgresPublicPlayerCredentialValidator } from "../application/gallery/content-credentials.js";
import { readGalleryRuntimeEligibility } from "../application/gallery/eligibility.js";
import { pool } from "../db/client.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/configured-object-storage.js";
import { GalleryContentObjectStorage, PostgresGalleryContentLookup } from "./adapters.js";
import { buildGalleryContentApp } from "./app.js";

const configuration = galleryConfigurationFromEnv(env);
const liveEligible = async () =>
  (await readGalleryRuntimeEligibility(pool, configuration)).eligible;
const app = buildGalleryContentApp({
  publicPlayer: new PostgresPublicPlayerCredentialValidator(pool, liveEligible),
  administratorReview: new PostgresAdministratorReviewCredentialValidator(pool),
  lookup: new PostgresGalleryContentLookup(pool),
  storage: new GalleryContentObjectStorage(createConfiguredObjectStorage(env))
});

serve({fetch: app.fetch, port: env.GALLERY_CONTENT_PORT});
