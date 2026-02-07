SHELL := /bin/bash

.PHONY: vps-check vps-hygiene-check vps-prune-archives deploy restart logs rollback release-gate smoke release

vps-check:
	./scripts/vps.sh check

vps-hygiene-check:
	./scripts/vps-hygiene-check.sh

vps-prune-archives:
	./scripts/vps-archive-prune.sh

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
