# Cloudflare Terraform Provider Qualification

## Qualified baseline

| Contract | Qualified value |
| --- | --- |
| Terraform CLI | `1.15.7`, pinned by `.mise.toml` and `required_version` |
| Provider | `registry.terraform.io/cloudflare/cloudflare` `5.22.0` |
| Provider signing identity | Self-signed Cloudflare provider key `C76001609EE3B136` reported by `terraform init` |
| Provider schema SHA-256 | `464d413d784d2251cc281af4320add27323fcf91af064fa2e37937ce71aaa2a9` |
| Wrangler | `4.112.0` |
| Workers compatibility date | `2026-07-19` |
| Workers compatibility flags | `nodejs_compat` |
| Containers package | `@cloudflare/containers` `0.3.7` |

The exact provider constraint is in `deploy/cloudflare/terraform/versions.tf`.
Terraform generated `deploy/cloudflare/terraform/.terraform.lock.hcl` from the
signed Registry release. Its `zh:` entries include the official package hashes
for all supported automation platforms:

| Platform | SHA-256 |
| --- | --- |
| `darwin_amd64` | `8437138c0af1a1a557b516ca42dae54499933cc81072396abe7eefd267218f79` |
| `darwin_arm64` | `d952f92ae1a688ed376757127ae1aa3b625571bf1fc606214a5822eae98213e0` |
| `linux_amd64` | `cd767016ea7382e384e560f6ddb302637ecb1b53ece15c9326032010effe6c33` |
| `linux_arm64` | `45f3b7c50254b1da1dc21e77e03cd1e931cab40fb75c7cba822a53ed54cd232e` |

Large provider binaries and `.terraform/` initialization directories are not
committed. The complete exported JSON schema is committed in deterministic
gzip form as
`deploy/cloudflare/terraform/cloudflare-provider-schema-5.22.0.json.gz`;
the validator decompresses it before checking the recorded digest.

## Required resource contract

`deploy/cloudflare/terraform/provider-contract.json` lists every provider
resource and field currently required by the target design. The checked
contract covers:

- private R2 buckets;
- product Queues and dead-letter/consumer configuration;
- queue delivery pause state;
- cache-disabled, TLS-configured Hyperdrive origins;
- Worker routes and custom domains; and
- Cron triggers, while final Terraform/Wrangler ownership remains gated by
  task 1.10.

The contract intentionally validates provider interface availability without
claiming that provisional Worker-coupled ownership has passed the disposable
account source-of-truth test.

## Verification

The following checks passed on 2026-07-21:

- `pnpm run cloudflare:toolchain-check`
- `mise exec -- terraform -chdir=deploy/cloudflare/terraform validate`
- exact provider version and constraint checks against `versions.tf` and the
  dependency lock;
- all four platform package hashes against Cloudflare's published
  `terraform-provider-cloudflare_5.22.0_SHA256SUMS`; and
- every resource and nested attribute in `provider-contract.json` against the
  exported provider schema.

Primary contracts used by the baseline are recorded in
`deploy/cloudflare/toolchain-baseline.json`, including the exact Terraform and
Cloudflare Provider release pages and HashiCorp provider/lock-file manuals.
