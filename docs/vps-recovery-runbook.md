# VPS Reliability + Recovery Runbook

This runbook is for zero-interactive deploy operations.

## Goal

Deploys should either:

1. complete, or
2. fail fast with a clear reason.

Deploys should never hang waiting for hidden SSH or sudo prompts.

## Preflight Checklist

Run from repo root:

```bash
./scripts/vps.sh doctor
```

Expected output includes:

- `doctor_connected:...`
- `doctor_app_dir_ok:...`
- `doctor_sudo_noninteractive:ok` (when using `VPS_SERVICE`)
- `doctor_ssh_stability_status:pass`
- `doctor_pass`

## One-Time Setup: Non-Interactive Sudo for Service Control

If `doctor_sudo_noninteractive:missing` appears, configure a minimal sudoers rule on VPS.

1. SSH to VPS console (normal interactive session):

```bash
ssh hetzner-codex
```

2. Create sudoers entry (replace `tony` and service name if needed):

```bash
sudo tee /etc/sudoers.d/vps-sentry-web >/dev/null <<'EOF'
tony ALL=(root) NOPASSWD: /usr/bin/systemctl restart vps-sentry-web.service, /usr/bin/systemctl status vps-sentry-web.service, /usr/bin/systemctl is-active vps-sentry-web.service, /usr/bin/journalctl -u vps-sentry-web.service *
EOF
sudo chmod 0440 /etc/sudoers.d/vps-sentry-web
sudo visudo -cf /etc/sudoers.d/vps-sentry-web
```

3. Validate from local machine:

```bash
ssh hetzner-codex "sudo -n true && echo sudo_noninteractive_ok"
```

## Standard Release Flow

```bash
make release-gate
make deploy
./scripts/release-smoke.sh
```

Or full path:

```bash
make release
```

## Incident: `ssh_unreachable:<host>`

Meaning: SSH connection could not be established in non-interactive mode.

Checks:

```bash
nc -vz <server-ip> 22
ssh -v hetzner-codex "echo ok"
```

Fixes:

- Ensure `sshd` is running: `sudo systemctl status ssh` (or `sshd`)
- Ensure port 22 is allowed in firewall/security group
- Ensure host key/user/key configuration is still valid

After fix:

```bash
./scripts/vps.sh doctor
```

## Incident: `doctor_fail:ssh_stability_guard_failed`

Meaning: SSH worked initially but failed under short burst probes (often firewall rate-limit behavior).

Checks:

```bash
make vps-ssh-stability-check
ssh hetzner-codex "sudo -n ufw status numbered"
```

Common root cause:

- `OpenSSH LIMIT IN` (or `22/tcp LIMIT IN`) present in UFW.

Typical fix:

```bash
ssh hetzner-codex "sudo ufw delete limit OpenSSH"
ssh hetzner-codex "sudo ufw allow 22/tcp"
make vps-ssh-stability-check
```

## Incident: `sudo_noninteractive_required`

Meaning: deploy is intentionally refusing interactive sudo prompts.

Fix:

- Apply the sudoers setup above, then rerun:

```bash
./scripts/vps.sh doctor
make deploy
```

Temporary bypass (not recommended):

```bash
VPS_REQUIRE_NONINTERACTIVE_SUDO=0 make deploy
```

## Incident: service restart failed

Check service details:

```bash
./scripts/vps.sh restart
./scripts/vps.sh logs
```

Direct status:

```bash
ssh hetzner-codex "sudo -n systemctl status vps-sentry-web.service --no-pager -n 80"
```

## Rollback Procedure

Rollback to previous commit:

```bash
make rollback TO=HEAD~1
./scripts/release-smoke.sh
```

Rollback to exact commit:

```bash
./scripts/vps.sh rollback <commit-ish>
./scripts/release-smoke.sh
```

## Operator Notes

- Keep `VPS_REQUIRE_NONINTERACTIVE_SUDO=1` for predictable automation.
- Run `./scripts/vps.sh doctor` before high-risk deploys.
- If SSH is down, use provider console access first, then re-run doctor.
