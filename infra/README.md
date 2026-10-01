# Infrastructure

One VM runs `deploy/docker-compose.yml`: Caddy (TLS, SPA, reverse proxy), the coordinator, and Litestream (SQLite backup to object storage). The coordinator holds provider WebSockets in memory, so scale up, not out. See #71 for the scaling plan.

## Provision

Use OpenTofu (MPL 2.0). Terraform >= 1.6 also works.

```sh
cd infra
cat > backend.hcl <<'EOF'
bucket   = "ie-tfstate"
key      = "staging/terraform.tfstate"
region   = "auto"
endpoints = { s3 = "https://<account>.r2.cloudflarestorage.com" }
skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
use_path_style              = true
EOF
export TF_VAR_hcloud_token=...   # never commit
tofu init -backend-config=backend.hcl
tofu plan -var ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)" -var 'ssh_allowed_cidrs=["<your-ip>/32"]'
tofu apply ...
```

Point the `IE_DOMAIN` DNS A/AAAA records at the `ipv4` / `ipv6` outputs.

## First deploy

```sh
scp deploy/.env root@<ip>:/opt/inference-exchange/deploy/.env   # from deploy/.env.example
ssh root@<ip> 'cd /opt/inference-exchange && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build'
```

## Runbook

- **Deploy a new version**: `git -C /opt/inference-exchange pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`
- **Rollback**: `git checkout <previous-sha>` then the same `up -d --build`
- **Restore DB**: stop `coordinator`, delete the `ie-data` volume, `up -d` again. The `restore` service pulls the latest replica.
- **Rotate `IE_JWT_SECRET`**: edit `.env`, restart `coordinator`. All users are signed out.
- **Logs**: `docker compose -f deploy/docker-compose.yml logs -f coordinator`

## Not yet covered

- GitHub Actions `plan`/`apply` with OIDC (#70)
- Metrics, error tracking, status page (#71)
