SHELL := /bin/bash

.PHONY: vps-check deploy restart logs rollback

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
