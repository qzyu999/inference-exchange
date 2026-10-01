output "ipv4" {
  description = "Point the IE_DOMAIN A record here"
  value       = hcloud_server.coordinator.ipv4_address
}

output "ipv6" {
  value = hcloud_server.coordinator.ipv6_address
}
