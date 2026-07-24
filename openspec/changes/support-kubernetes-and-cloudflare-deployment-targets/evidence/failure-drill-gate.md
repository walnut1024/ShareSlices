# Deployment failure-drill gate

Evidence date: 2026-07-25

`mise run verification-failure-drills` is the provider-neutral local failure
gate. It executes real implementation tests rather than a second simulation
model:

| Required failure | Executable evidence |
| --- | --- |
| Migration failure | The phase engine journals the migration as failed, preserves the stable reason, and never enters a later runtime phase. |
| Dependency outage | Kubernetes `doctor` fails closed for DNS, permission, Secret, release-store, image, and current network-evidence failures. |
| Incorrect CDN caching | Core verification rejects cache-policy drift, and Kubernetes external-CDN verification rejects edge/origin divergence. |
| Resend rate limiting | The shared Resend transport classifies `rate_limit_exceeded`, daily quota, monthly quota, retry headers, network ambiguity, and server failures without exposing the key. |
| SMTP outage | The shared SMTP transport classifies connection refusal as known not submitted and does not convert it to provider acceptance. |
| Unsafe Gallery topology | Gallery eligibility rejects same Origin, same host on another port, sibling sites, management Cookies spanning content, IP topology, and every missing live capability. |
| Incompatible rollback | Shared and Kubernetes rollback refuse unrecorded, schema-incompatible, job-incompatible, configuration-mismatched, missing-image, and unavailable-Secret predecessors before mutation. |

The gate does not mutate a provider account or send email. Live dependency,
provider, and rollback drills remain part of representative target acceptance
in task 15.11.
