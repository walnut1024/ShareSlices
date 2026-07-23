output "private_prerequisites" {
  description = "Validated inputs consumed by the Wrangler and deployment Adapters."
  value = {
    account_id                   = var.account_id
    artifact_bucket_name         = cloudflare_r2_bucket.artifacts.name
    deployment_state_bucket_name = cloudflare_r2_bucket.deployment_state.name
    jobs_queue_id                = cloudflare_queue.jobs.queue_id
    jobs_queue_name              = cloudflare_queue.jobs.queue_name
    dead_letter_queue_id         = cloudflare_queue.dead_letter.queue_id
    dead_letter_queue_name       = cloudflare_queue.dead_letter.queue_name
    hyperdrive_id                = cloudflare_hyperdrive_config.application.id
    hyperdrive_name              = cloudflare_hyperdrive_config.application.name
    hyperdrive_caching_disabled  = cloudflare_hyperdrive_config.application.caching.disabled
    hyperdrive_origin_sslmode    = cloudflare_hyperdrive_config.application.mtls.sslmode
    hyperdrive_connection_limit  = cloudflare_hyperdrive_config.application.origin_connection_limit
  }
}

output "activation" {
  description = "Ingress identities managed only by the activation phase."
  value = {
    enabled        = var.activate_ingress
    custom_domains = { for key, resource in cloudflare_workers_custom_domain.activated : key => resource.id }
    worker_routes  = { for key, resource in cloudflare_workers_route.activated : key => resource.id }
  }
}

