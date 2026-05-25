# Kijani Kiosk — Capstone Project

A CI/CD capstone project built around the **kijanikiosk-payment** Node.js app. The pipeline runs in Jenkins, publishes build artifacts to a Nexus npm registry, and both services communicate over a shared Docker network.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Prerequisites](#prerequisites)
3. [Container Setup](#container-setup)
    - [1. Create the shared Docker network](#1-create-the-shared-docker-network)
    - [2. Start Nexus](#2-start-nexus)
    - [3. Configure Nexus](#3-configure-nexus)
    - [4. Start Jenkins](#4-start-jenkins)
    - [5. Configure Jenkins](#5-configure-jenkins)
4. [Pipeline Stages](#pipeline-stages)
5. [Local Development](#local-development)
6. [Project Structure](#project-structure)

## Project Overview

| Component         | Technology                   |
| ----------------- | ---------------------------- |
| Application       | Node.js 24 / Express         |
| CI server         | Jenkins (Docker)             |
| Artifact registry | Sonatype Nexus 3 (Docker)    |
| Container network | `shared-net` (Docker bridge) |
| npm registry path | `capstone-kijanikiosk/`      |

## Prerequisites

- Docker Engine 24+
- Docker Compose (optional, for convenience)
- Git

## Container Setup

### 1. Create the shared Docker network

Jenkins and Nexus must be on the same Docker network so the pipeline can resolve the `nexus` hostname.

```bash
docker network create shared-net
```

### 2. Start Nexus

```bash
docker run -d \
  --name nexus \
  --network shared-net \
  -p 8081:8081 \
  -v nexus-data:/nexus-data \
  sonatype/nexus3:latest
```

Wait ~2 minutes for Nexus to finish starting, then verify it is up:

```bash
docker logs -f nexus   # look for "Started Sonatype Nexus"
```

### 3. Configure Nexus

1. Open **http://localhost:8081** in your browser.
2. Sign in. The initial admin password is inside the container:
    ```bash
    docker exec nexus cat /nexus-data/admin.password
    ```
3. Follow the setup wizard and set a permanent admin password.
4. Create an **npm (hosted)** repository:
    - **Name:** `capstone-kijanikiosk`
    - **Deployment policy:** Allow redeploy
5. Enable the **npm Bearer Token realm** so `npm publish` can authenticate:
    - Go to **Security → Realms** and activate _npm Bearer Token Realm_.

### 4. Start Jenkins

```bash
docker run -d \
  --name jenkins \
  --network shared-net \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins-home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
```

> **Why mount the Docker socket?** The Jenkinsfile uses a `docker` agent (`node:24`). Jenkins needs access to the host Docker daemon to spin up that container during the build.

Retrieve the initial admin password:

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Open **http://localhost:8080**, unlock Jenkins, and install the suggested plugins (ensure the **Docker Pipeline** plugin is included).

### 5. Configure Jenkins

#### Add Nexus credentials

The pipeline looks for a credential with ID **`nexus-credentials`**.

1. Go to **Manage Jenkins → Credentials → (global) → Add Credentials**.
2. Kind: **Username with password**
3. Username: your Nexus admin username
4. Password: your Nexus admin password
5. **ID:** `nexus-credentials`

#### Create the pipeline job

1. **New Item → Pipeline**
2. Under _Pipeline_, set _Definition_ to **Pipeline script from SCM**.
3. SCM: Git — point it at this repository.
4. Script path: `Jenkinsfile`
5. Save and run **Build Now**.

## Pipeline Stages

| Stage                       | What it does                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup**                   | Detects `package.json` location, reads the semver version, and appends the short Git SHA to create a unique `ARTIFACT_VERSION`.                               |
| **Lint**                    | Runs `npm ci` then `npm run lint` (ESLint) inside the `node:24` container.                                                                                    |
| **Build**                   | Runs `npm run build`, which copies `src/` and `package.json` into a `dist/` directory, then stashes the output.                                               |
| **Verify → Test**           | Runs `npm test` (Jest with coverage) and publishes JUnit XML results.                                                                                         |
| **Verify → Security Audit** | Runs `npm audit --audit-level=high` and archives the report. Both Verify stages run in parallel.                                                              |
| **Archive**                 | Archives the `dist/` directory as a Jenkins build artifact (fingerprinted).                                                                                   |
| **Publish**                 | Writes a temporary `.npmrc` pointing at the Nexus `capstone-kijanikiosk` repository, bumps the package version to `ARTIFACT_VERSION`, and runs `npm publish`. |

## Local Development

```bash
cd app/kijanikiosk-payment

# Install dependencies
npm install

# Start the dev server (hot-reload via nodemon)
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Build dist/
npm run build
```

The server listens on **port 3000** by default. The health endpoint is available at `GET /health`.

## Project Structure

```
kijanikiosk-capstone/
├── Jenkinsfile                        # CI/CD pipeline definition
├── app/
│   └── kijanikiosk-payment/
│       ├── src/
│       │   ├── app.js                 # Express app (routes)
│       │   └── server.js              # HTTP server entry point
│       ├── test/
│       │   └── payment.test.js
│       ├── Dockerfile.production      # Multi-stage production image
│       └── package.json
├── docs/
├── k8s/                               # Kubernetes manifests (coming soon)
├── observability/                     # Monitoring/logging configs (coming soon)
├── scripts/                           # Utility scripts (coming soon)
└── serverless/                        # Serverless function configs (coming soon)
```
