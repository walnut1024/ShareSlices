resource "cloudflare_r2_bucket" "artifacts" {
  account_id    = var.account_id
  name          = var.artifact_bucket_name
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket" "deployment_state" {
  account_id    = var.account_id
  name          = var.deployment_state_bucket_name
  storage_class = "Standard"
}

resource "cloudflare_queue" "dead_letter" {
  account_id = var.account_id
  queue_name = var.dead_letter_queue_name
}

resource "cloudflare_queue" "jobs" {
  account_id = var.account_id
  queue_name = var.jobs_queue_name
}

resource "cloudflare_hyperdrive_config" "application" {
  account_id = var.account_id
  name       = var.hyperdrive_name

  origin = {
    scheme   = "postgresql"
    host     = var.postgresql_origin.host
    port     = var.postgresql_origin.port
    database = var.postgresql_origin.database
    user     = var.postgresql_origin.user
    password = var.postgresql_origin.password
  }

  mtls = {
    sslmode = "verify-full"
  }

  caching = {
    disabled = true
  }

  origin_connection_limit = var.hyperdrive_origin_connection_limit
}

resource "cloudflare_workers_custom_domain" "activated" {
  for_each = var.activate_ingress ? var.custom_domains : {}

  account_id = var.account_id
  hostname   = each.value.hostname
  service    = each.value.service
  zone_id    = each.value.zone_id
}

resource "cloudflare_workers_route" "activated" {
  for_each = var.activate_ingress ? var.worker_routes : {}

  pattern = each.value.pattern
  script  = each.value.script
  zone_id = each.value.zone_id
}
