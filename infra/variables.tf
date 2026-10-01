variable "hcloud_token" {
  description = "Hetzner Cloud API token (pass via TF_VAR_hcloud_token, never commit)"
  type        = string
  sensitive   = true
}

variable "name" {
  description = "Server name"
  type        = string
  default     = "ie-coordinator"
}

variable "environment" {
  description = "staging or prod"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod"
  }
}

variable "server_type" {
  description = "Hetzner server type; scale up (not out) as load grows"
  type        = string
  default     = "cpx21"
}

variable "location" {
  type    = string
  default = "ash"
}

variable "ssh_public_key" {
  type = string
}

variable "ssh_allowed_cidrs" {
  description = "Who may SSH in. Restrict to your IPs."
  type        = list(string)
}

variable "repo_url" {
  type    = string
  default = "https://github.com/qzyu999/inference-exchange.git"
}

variable "git_ref" {
  description = "Branch, tag, or commit to deploy"
  type        = string
  default     = "main"
}
