SHELL := /bin/bash

.PHONY: vps-check vps-doctor vps-ssh-stability-check vps-hygiene-check vps-prune-archives vps-monitor vps-monitor-alert vps-slo-check vps-slo-alert vps-queue-alert vps-backup vps-backup-dry-run vps-restore-drill vps-rpo-rto-report vps-rpo-rto-report-alert vps-backup-automation-status vps-backup-automation-install vps-backup-automation-remove vps-restore-drill-automation-status vps-restore-drill-automation-install vps-restore-drill-automation-remove vps-ops-safety-automation-status vps-ops-safety-automation-install vps-ops-safety-automation-remove vps-ops-worker-status vps-ops-worker-install vps-ops-worker-remove vps-ops-worker-restart vps-ops-worker-logs security-headers-check perf-load-smoke supply-chain-check supply-chain-check-strict chaos-certify chaos-certify-fast sentinel-scorecard sentinel-scorecard-fast sentinel-scorecard-strict deploy restart logs rollback release-gate smoke release db-generate-sqlite db-generate-postgres db-pg-init db-pg-copy db-pg-verify db-pg-shadow db-pg-acceptance db-pg-migrate db-pg-cutover db-pg-rollback ops-worker ops-worker-once host-key-verify

vps-check:
	./scripts/vps.sh check

vps-doctor:
	./scripts/vps.sh doctor

vps-ssh-stability-check:
	./scripts/vps.sh ssh-stability-check

vps-hygiene-check:
	./scripts/vps-hygiene-check.sh

vps-prune-archives:
	./scripts/vps-archive-prune.sh

vps-monitor:
	./scripts/vps-monitor.sh

vps-monitor-alert:
	./scripts/vps-monitor.sh --alert

vps-slo-check:
	./scripts/vps-slo-burn-rate.sh --no-alert

vps-slo-alert:
	./scripts/vps-slo-burn-rate.sh --alert

vps-queue-alert:
	./scripts/vps-queue-alert.sh --alert

vps-backup:
	./scripts/vps-backup.sh

vps-backup-dry-run:
	./scripts/vps-backup.sh --dry-run

vps-restore-drill:
	./scripts/vps-restore-drill.sh

vps-rpo-rto-report:
	./scripts/vps-rpo-rto-report.sh

vps-rpo-rto-report-alert:
	./scripts/vps-rpo-rto-report.sh --alert

vps-backup-automation-status:
	./scripts/vps-backup-automation.sh status

vps-backup-automation-install:
	./scripts/vps-backup-automation.sh install

vps-backup-automation-remove:
	./scripts/vps-backup-automation.sh remove

vps-restore-drill-automation-status:
	./scripts/vps-restore-drill-automation.sh status

vps-restore-drill-automation-install:
	./scripts/vps-restore-drill-automation.sh install

vps-restore-drill-automation-remove:
	./scripts/vps-restore-drill-automation.sh remove

vps-ops-safety-automation-status:
	./scripts/vps-ops-safety-automation.sh status

vps-ops-safety-automation-install:
	./scripts/vps-ops-safety-automation.sh install

vps-ops-safety-automation-remove:
	./scripts/vps-ops-safety-automation.sh remove

vps-ops-worker-status:
	./scripts/vps-ops-worker-service.sh status

vps-ops-worker-install:
	./scripts/vps-ops-worker-service.sh install

vps-ops-worker-remove:
	./scripts/vps-ops-worker-service.sh remove

vps-ops-worker-restart:
	./scripts/vps-ops-worker-service.sh restart

vps-ops-worker-logs:
	./scripts/vps-ops-worker-service.sh logs

security-headers-check:
	./scripts/security-headers-check.sh

perf-load-smoke:
	./scripts/perf-load-smoke.sh --remote

supply-chain-check:
	./scripts/supply-chain-check.sh --no-lock-verify

supply-chain-check-strict:
	./scripts/supply-chain-check.sh --strict

chaos-certify:
	./scripts/chaos-certify.sh --remote

chaos-certify-fast:
	./scripts/chaos-certify.sh --remote --skip-restart

sentinel-scorecard:
	node ./scripts/sentinel-prime-scorecard.mjs

sentinel-scorecard-fast:
	node ./scripts/sentinel-prime-scorecard.mjs --fast

sentinel-scorecard-strict:
	node ./scripts/sentinel-prime-scorecard.mjs --strict

deploy:
	./scripts/vps.sh deploy

restart:
	./scripts/vps.sh restart

logs:
	./scripts/vps.sh logs

rollback:
	./scripts/vps.sh rollback $(TO)

release-gate:
	./scripts/release-gate.sh

smoke:
	./scripts/release-smoke.sh

release: release-gate deploy smoke

db-pg-init:
	./scripts/db/postgres-init.sh

db-pg-copy:
	./scripts/db/sqlite-to-postgres-copy.sh

db-pg-verify:
	./scripts/db/sqlite-postgres-verify.sh

db-pg-shadow:
	./scripts/db/sqlite-postgres-shadow-read.sh

db-pg-acceptance:
	./scripts/db/sqlite-postgres-acceptance.sh

db-pg-migrate:
	./scripts/db/sqlite-to-postgres-migrate.sh

db-pg-cutover:
	./scripts/db/postgres-cutover.sh

db-pg-rollback:
	./scripts/db/postgres-rollback.sh

db-generate-sqlite:
	./scripts/db/prisma-generate-provider.sh sqlite

db-generate-postgres:
	./scripts/db/prisma-generate-provider.sh postgres

ops-worker:
	node ./scripts/ops-worker.mjs

ops-worker-once:
	node ./scripts/ops-worker.mjs --once

host-key-verify:
	HOST_ID="$(HOST_ID)" HOST_TOKEN="$(HOST_TOKEN)" HOST_KEY_SCOPE="$(HOST_KEY_SCOPE)" BASE_URL="$(BASE_URL)" ./scripts/host-key-verify.sh
