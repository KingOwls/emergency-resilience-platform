SHELL := /bin/bash

init:
	./scripts/bootstrap-local.sh

build: init
	docker compose build

up: init
	docker compose up -d --build

db: init
	docker compose up -d --build db

front: init
	docker compose up -d --build frontend

intake: init
	docker compose up -d --build db intake-triage

dispatch: init
	docker compose up -d --build db dispatch-resource

geo: init
	docker compose up -d --build db geospatial-zone

notification: init
	docker compose up -d --build db notification-status

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=100

smoke:
	./scripts/smoke-local.sh

rls:
	./scripts/test-rls.sh

chaos:
	./scripts/chaos-local.sh

down:
	docker compose down

reset:
	docker compose down -v --remove-orphans
	rm -rf .local-secrets
