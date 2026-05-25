# KijaniKiosk Payment Service

A simple Express.js REST API that simulates a payment service. Built as a CI/CD example for Jenkins pipelines.

## Endpoints

| Method | Path                    | Description               |
| ------ | ----------------------- | ------------------------- |
| `GET`  | `/health`               | Health check              |
| `POST` | `/payments`             | Initiate a payment        |
| `GET`  | `/payments/:id`         | Get payment status        |
| `POST` | `/payments/:id/capture` | Capture a pending payment |
| `POST` | `/payments/:id/refund`  | Refund a captured payment |

### Example: create a payment

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 150, "currency": "KES", "method": "mpesa"}'
```

## Commands

```bash
# Install dependencies
npm install

# Start the server (port 3000)
npm start

# Start with auto-reload
npm run dev

# Run tests with coverage
npm test

# Lint source files
npm run lint

# Build: produces a dist/ folder
npm run build
```

## Project Structure

```
src/
  app.js      # Express app and all route handlers
  server.js   # HTTP server entry point
test/
  payment.test.js
scripts/
  build.sh    # Full pipeline: install → lint → test → dist
```
