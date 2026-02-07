SHELL := /bin/bash

.PHONY: vps-check deploy restart logs rollback release-gate smoke release

vps-check:
	./scripts/vps.sh check

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
