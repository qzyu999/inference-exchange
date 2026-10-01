# Single-VM coordinator on Hetzner Cloud, provisioned by cloud-init to run deploy/docker-compose.yml.
# Works with OpenTofu (preferred, MPL 2.0) or Terraform. See infra/README.md.

terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
  # Remote state: configure an S3-compatible backend at init time, e.g.
  #   tofu init -backend-config=backend.hcl
  backend "s3" {}
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "ops" {
  name       = "${var.name}-ops"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "coordinator" {
  name = "${var.name}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }
  dynamic "rule" {
    for_each = ["80", "443"]
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.value
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  }
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "coordinator" {
  name         = var.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.ops.id]
  firewall_ids = [hcloud_firewall.coordinator.id]

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    repo_url = var.repo_url
    git_ref  = var.git_ref
  })

  labels = {
    app = "inference-exchange"
    env = var.environment
  }
}
