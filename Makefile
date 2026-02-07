SHELL := /bin/bash

.PHONY: vps-check vps-doctor vps-hygiene-check vps-prune-archives vps-monitor vps-monitor-alert vps-backup vps-backup-dry-run vps-restore-drill vps-backup-automation-status vps-backup-automation-install vps-backup-automation-remove deploy restart logs rollback release-gate smoke release db-pg-init db-pg-copy db-pg-verify db-pg-migrate

vps-check:
	./scripts/vps.sh check

vps-doctor:
	./scripts/vps.sh doctor

vps-hygiene-check:
	./scripts/vps-hygiene-check.sh

vps-prune-archives:
	./scripts/vps-archive-prune.sh

vps-monitor:
	./scripts/vps-monitor.sh

vps-monitor-alert:
	./scripts/vps-monitor.sh --alert

vps-backup:
	./scripts/vps-backup.sh

vps-backup-dry-run:
	./scripts/vps-backup.sh --dry-run

vps-restore-drill:
	./scripts/vps-restore-drill.sh

vps-backup-automation-status:
	./scripts/vps-backup-automation.sh status

vps-backup-automation-install:
	./scripts/vps-backup-automation.sh install

vps-backup-automation-remove:
	./scripts/vps-backup-automation.sh remove

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

db-pg-migrate:
	./scripts/db/sqlite-to-postgres-migrate.sh
