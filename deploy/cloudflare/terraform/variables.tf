variable "account_id" {
  description = "Cloudflare account that already owns the selected zones."
  type        = string
}

variable "installation_id" {
  description = "Stable DNS-label installation identity used in owned resource names."
  type        = string
}

variable "artifact_bucket_name" {
  description = "Private R2 bucket containing Artifact objects."
  type        = string
}

variable "deployment_state_bucket_name" {
  description = "Private R2 bucket containing the Secret-free deployment-state mirror."
  type        = string
}

variable "jobs_queue_name" {
  description = "Product job wake Queue name. Consumer attachment has a separate qualified owner."
  type        = string
}

variable "dead_letter_queue_name" {
  description = "Product dead-letter Queue name."
  type        = string
}

variable "hyperdrive_name" {
  description = "Stable Hyperdrive configuration name."
  type        = string
}

variable "postgresql_origin" {
  description = "Write-only PostgreSQL origin configuration. Values enter encrypted Terraform state."
  sensitive   = true
  type = object({
    host     = string
    port     = number
    database = string
    user     = string
    password = string
  })
}

variable "hyperdrive_origin_connection_limit" {
  description = "Explicit database connection budget for this installation."
  type        = number

  validation {
    condition     = var.hyperdrive_origin_connection_limit >= 1 && var.hyperdrive_origin_connection_limit <= 100
    error_message = "Hyperdrive origin connection limit must be between 1 and 100."
  }
}

variable "activate_ingress" {
  description = "Attach long-lived ingress only in the separately authorized activation phase."
  type        = bool
  default     = false
}

variable "custom_domains" {
  description = "Custom domains attached only after Worker candidate verification."
  type = map(object({
    hostname = string
    zone_id  = string
    service  = string
  }))
  default = {}
}

variable "worker_routes" {
  description = "Zone routes attached only after Worker candidate verification."
  type = map(object({
    pattern = string
    zone_id = string
    script  = string
  }))
  default = {}
}

