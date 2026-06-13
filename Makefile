.PHONY: install test test-web demo-offline dev build e2e ci serve run

install:
	cd backend && npm install
	cd web && npm install

test:
	cd backend && npx vitest run --coverage

test-web:
	cd web && npx vitest run --coverage

demo-offline:
	cd backend && npx tsx src/bin-demo.ts

dev:
	cd web && npm run dev

build:
	cd web && npm run build

e2e:
	cd web && npx playwright test

ci: test test-web build demo-offline

# Build the web console then serve the whole product (API + console) on one port.
# Visit http://localhost:8080  (set PORT=... and AF_DATA=./data for durable storage)
run: build serve

serve:
	cd backend && npm run serve

