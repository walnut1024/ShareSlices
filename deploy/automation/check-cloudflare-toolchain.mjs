import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = new URL("../cloudflare/toolchain-baseline.json", import.meta.url);
const terraformRoot = new URL("../cloudflare/terraform/", import.meta.url);
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const rootPackage = JSON.parse(
  await readFile(new URL("package.json", `file://${repositoryRoot}/`), "utf8"),
);

function fail(message) {
  throw new Error(`Cloudflare toolchain baseline mismatch: ${message}`);
}

async function requirePackageVersion(packageName, expectedVersion) {
  const packagePath = new URL(
    `node_modules/${packageName}/package.json`,
    `file://${repositoryRoot}/`,
  );
  const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageMetadata.version !== expectedVersion) {
    fail(`${packageName} resolved to ${packageMetadata.version}; expected ${expectedVersion}`);
  }
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

function requireTerraformAttribute(providerSchema, resourceName, attributePath) {
  const resource = providerSchema.resource_schemas?.[resourceName];
  if (!resource) fail(`the provider schema does not define ${resourceName}`);

  let attributes = resource.block?.attributes;
  for (const [index, segment] of attributePath.split(".").entries()) {
    const attribute = attributes?.[segment];
    if (!attribute) {
      fail(`the provider schema does not define ${resourceName}.${attributePath}`);
    }
    if (index < attributePath.split(".").length - 1) {
      attributes = attribute.nested_type?.attributes;
    }
  }
}

if (rootPackage.devDependencies?.wrangler !== baseline.wrangler.version) {
  fail("the root Wrangler dependency is not pinned to the qualified version");
}
if (
  rootPackage.devDependencies?.[baseline.containerPackage.name] !==
  baseline.containerPackage.version
) {
  fail("the root Container package dependency is not pinned to the qualified version");
}

await requirePackageVersion("wrangler", baseline.wrangler.version);
await requirePackageVersion(baseline.containerPackage.name, baseline.containerPackage.version);

const wranglerPackagePath = require.resolve("wrangler/package.json", {
  paths: [repositoryRoot],
});
const wranglerSchemaPath = new URL("config-schema.json", `file://${wranglerPackagePath}`);
const wranglerSchema = await readFile(wranglerSchemaPath);
const actualSchemaDigest = createHash("sha256").update(wranglerSchema).digest("hex");
if (actualSchemaDigest !== baseline.wrangler.configurationSchemaSha256) {
  fail(
    `Wrangler configuration schema digest is ${actualSchemaDigest}; expected ${baseline.wrangler.configurationSchemaSha256}`,
  );
}

if (!baseline.workersRuntime.compatibilityFlags.includes("nodejs_compat")) {
  fail("the qualified runtime flags must include nodejs_compat");
}

const terraformVersion = "1.15.7";
const terraformProvider = baseline.terraformProvider;
const versionsConfiguration = await readFile(new URL("versions.tf", terraformRoot), "utf8");
requireMatch(
  versionsConfiguration,
  new RegExp(`required_version\\s*=\\s*"= ${terraformVersion.replaceAll(".", "\\.")}"`),
  `Terraform required_version is not pinned to ${terraformVersion}`,
);
requireMatch(
  versionsConfiguration,
  new RegExp(`version\\s*=\\s*"= ${terraformProvider.version.replaceAll(".", "\\.")}"`),
  `the Cloudflare provider constraint is not pinned to ${terraformProvider.version}`,
);

const lockFile = await readFile(new URL(".terraform.lock.hcl", terraformRoot), "utf8");
requireMatch(
  lockFile,
  new RegExp(`version\\s*=\\s*"${terraformProvider.version.replaceAll(".", "\\.")}"`),
  `the dependency lock does not select Cloudflare provider ${terraformProvider.version}`,
);
for (const [platform, digest] of Object.entries(terraformProvider.platformPackageSha256)) {
  if (!lockFile.includes(`zh:${digest}`)) {
    fail(`the dependency lock is missing the official ${platform} package checksum`);
  }
}

const providerContract = JSON.parse(
  await readFile(new URL("provider-contract.json", terraformRoot), "utf8"),
);
if (providerContract.providerVersion !== terraformProvider.version) {
  fail("the Terraform provider contract version does not match the baseline");
}
const compressedProviderSchema = await readFile(
  new URL(`cloudflare-provider-schema-${terraformProvider.version}.json.gz`, terraformRoot),
);
const providerSchemaBytes = gunzipSync(compressedProviderSchema);
const providerSchemaDigest = createHash("sha256").update(providerSchemaBytes).digest("hex");
if (providerSchemaDigest !== terraformProvider.schemaSha256) {
  fail(
    `the Terraform provider schema digest is ${providerSchemaDigest}; expected ${terraformProvider.schemaSha256}`,
  );
}
const providerSchemas = JSON.parse(providerSchemaBytes);
const providerSchema = providerSchemas.provider_schemas?.[providerContract.providerAddress];
if (!providerSchema) fail(`the schema does not contain ${providerContract.providerAddress}`);
for (const [resourceName, attributePaths] of Object.entries(providerContract.resources)) {
  for (const attributePath of attributePaths) {
    requireTerraformAttribute(providerSchema, resourceName, attributePath);
  }
}

process.stdout.write(
  `${JSON.stringify({
    baselineVersion: baseline.baselineVersion,
    wrangler: baseline.wrangler.version,
    terraformProvider: baseline.terraformProvider.version,
    terraformProviderSchemaSha256: providerSchemaDigest,
    terraformProviderResources: Object.keys(providerContract.resources).sort(),
    compatibilityDate: baseline.workersRuntime.compatibilityDate,
    compatibilityFlags: baseline.workersRuntime.compatibilityFlags,
    containerPackage: baseline.containerPackage.version,
    configurationSchemaSha256: actualSchemaDigest,
  })}\n`,
);
