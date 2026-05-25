# KijaniKiosk Capstone

A CI/CD capstone (Track A: Infrastructure-First) built around the **kijanikiosk-payment** Node.js microservice. The pipeline runs in Jenkins, deploys to a staging Kubernetes namespace, runs a smoke test, waits for human approval, then deploys to production. Staging is provisioned by Terraform and configured by Ansible. A serverless receipt handler demonstrates an event-driven S3 trigger chain.

## Table of Contents

1. [Handover Guide](#handover-guide)
2. [Project Overview](#project-overview)
3. [Prerequisites](#prerequisites)
4. [Container Setup](#container-setup)
5. [Infrastructure Setup](#infrastructure-setup)
6. [Bootstrap the Cluster](#bootstrap-the-cluster)
7. [Pipeline Stages](#pipeline-stages)
8. [Receipt Handler](#receipt-handler)
9. [Local Development](#local-development)
10. [Project Structure](#project-structure)

---

## Handover Guide

Follow these steps in order on a clean machine. Each section below has the full details.

**Step 1 - Install host tools**

Docker Engine 24+, kubectl 1.29+, minikube 1.32+, Node.js 20+, Terraform 1.7+, Ansible 2.15+, and curl. See [Prerequisites](#prerequisites).

**Step 2 - Start minikube**

```bash
minikube start --driver=docker
```

**Step 3 - Create the shared Docker network**

```bash
docker network create shared-net
```

**Step 4 - Start and configure Nexus**

See [Container Setup: Start Nexus](#2-start-nexus) and [Configure Nexus](#3-configure-nexus).

**Step 5 - Start Jenkins**

See [Container Setup: Start Jenkins](#4-start-jenkins).

**Step 6 - Prepare Jenkins to talk to minikube**

Install kubectl inside the Jenkins container and connect it to the minikube Docker network. Both are required for the deploy and smoke-test stages.

```bash
# Install kubectl inside the container
JENKINS_ID=$(docker inspect --format='{{.Id}}' jenkins)
docker exec -u root "$JENKINS_ID" bash -c "
  curl -LO https://dl.k8s.io/release/\$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl
  install -m 0755 kubectl /usr/local/bin/kubectl
  rm kubectl"

# Connect Jenkins to the minikube Docker network so it can reach the API server
docker network connect minikube jenkins
```

Verify both:

```bash
docker exec jenkins kubectl version --client
docker exec jenkins curl -sk https://192.168.49.2:8443 | head -c 100
```

**Step 7 - Generate a flattened kubeconfig**

The default `~/.kube/config` references certificate files on your host by path. Those paths do not exist inside the Jenkins container. Generate a self-contained version with all certificates embedded:

```bash
kubectl config view --minify --flatten > /tmp/jenkins-kubeconfig
```

**Step 8 - Add Jenkins credentials**

See [Configure Jenkins Credentials](#6-configure-jenkins-credentials). You need three credentials: `nexus-credentials`, `dockerhub-credentials`, and `kubeconfig`. Use `/tmp/jenkins-kubeconfig` for the kubeconfig secret file.

**Step 9 - Provision staging with Terraform**

```bash
cd iac/terraform
terraform init
terraform apply
```

**Step 10 - Configure staging with Ansible**

```bash
pip install ansible-core kubernetes
ansible-galaxy collection install kubernetes.core
ansible-playbook iac/ansible/staging-config.yml
```

**Step 11 - Bootstrap the cluster**

```bash
bash scripts/bootstrap.sh
```

**Step 12 - Create the Jenkins pipeline job and run it**

See [Create the Pipeline Job](#7-create-the-pipeline-job). Click **Build Now** once the job is created.

**Ports at a glance**

| Service                  | URL                               |
| ------------------------ | --------------------------------- |
| Jenkins                  | http://localhost:8080             |
| Nexus                    | http://localhost:8081             |
| kk-payments (production) | http://\<minikube-ip\>:30000      |
| kk-payments (staging)    | http://\<minikube-ip\>:30001      |
| Receipt handler HTTP API | http://localhost:3000 (local dev) |
| Receipt handler local S3 | http://localhost:4569 (local dev) |

Get the minikube IP with `minikube ip`.

---

## Project Overview

| Component            | Technology                                                      |
| -------------------- | --------------------------------------------------------------- |
| Application          | Node.js 24 / Express                                            |
| CI server            | Jenkins (Docker)                                                |
| Container registry   | Docker Hub                                                      |
| Artifact registry    | Sonatype Nexus 3 (npm)                                          |
| Container network    | `shared-net` (Docker bridge)                                    |
| Kubernetes cluster   | minikube (single-node, Docker driver)                           |
| Staging namespace    | `kijani-staging` (Terraform-managed)                            |
| Production namespace | `default`                                                       |
| IaC                  | Terraform + Ansible                                             |
| Observability        | Prometheus + Grafana                                            |
| Receipt chain        | Serverless Framework (serverless-offline + serverless-s3-local) |

---

## Prerequisites

| Tool          | Minimum version | Notes                                             |
| ------------- | --------------- | ------------------------------------------------- |
| Docker Engine | 24+             | https://docs.docker.com/engine/install/           |
| kubectl       | 1.29+           | https://kubernetes.io/docs/tasks/tools/           |
| minikube      | 1.32+           | https://minikube.sigs.k8s.io/docs/start/          |
| Node.js       | 20+             | https://nodejs.org/                               |
| Terraform     | 1.7+            | https://developer.hashicorp.com/terraform/install |
| Ansible       | 2.15+           | `pip install ansible-core kubernetes`             |
| curl          | any             | Usually pre-installed on Linux/macOS              |

---

## Container Setup

### 1. Create the shared Docker network

Jenkins and Nexus must share a Docker network so the pipeline can resolve the `nexus` hostname.

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

Wait about 2 minutes, then confirm Nexus is ready:

```bash
docker logs -f nexus   # look for: Started Sonatype Nexus
```

### 3. Configure Nexus

1. Open **http://localhost:8081** in your browser.
2. Sign in. Get the initial admin password:
    ```bash
    docker exec nexus cat /nexus-data/admin.password
    ```
3. Complete the setup wizard and set a permanent admin password.
4. Create an **npm (hosted)** repository:
    - **Name:** `capstone-kijanikiosk`
    - **Deployment policy:** Allow redeploy
5. Enable the npm Bearer Token realm:
    - Go to **Security > Realms** and activate **npm Bearer Token Realm**.

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

The Docker socket is mounted so Jenkins can build and push container images from within the container.

Get the initial admin password:

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Open **http://localhost:8080**, unlock Jenkins, and install suggested plugins. Make sure the **Docker Pipeline** plugin is included.

### 5. Install kubectl and connect to minikube

Install kubectl inside the Jenkins container and connect it to the minikube Docker network. Minikube uses the Docker driver on Linux, so its API server runs inside a Docker container on the `minikube` network. Without this network connection Jenkins cannot reach the cluster even with a valid kubeconfig.

```bash
# Install kubectl
JENKINS_ID=$(docker inspect --format='{{.Id}}' jenkins)
docker exec -u root "$JENKINS_ID" bash -c "
  curl -LO https://dl.k8s.io/release/\$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl
  install -m 0755 kubectl /usr/local/bin/kubectl
  rm kubectl"

# Connect Jenkins to the minikube Docker network
docker network connect minikube jenkins
```

Verify:

```bash
docker exec jenkins kubectl version --client
docker exec jenkins curl -sk https://192.168.49.2:8443 | head -c 100
```

Note: `docker network connect` does not persist across container restarts. Re-run it if you recreate the Jenkins container.

### 6. Configure Jenkins credentials

Go to **Manage Jenkins > Credentials > (global) > Add Credentials** for each entry below.

**Nexus**

- Kind: Username with password
- Username: your Nexus admin username
- Password: your Nexus admin password
- ID: `nexus-credentials`

**Docker Hub**

- Kind: Username with password
- Username: your Docker Hub username
- Password: your Docker Hub access token (not your account password)
- ID: `dockerhub-credentials`

**kubeconfig**

The default `~/.kube/config` stores certificate paths that only exist on your host. Jenkins runs in a container and cannot read those paths. Generate a self-contained kubeconfig with all certificates embedded before uploading:

```bash
kubectl config view --minify --flatten > /tmp/jenkins-kubeconfig
```

- Kind: Secret file
- File: upload `/tmp/jenkins-kubeconfig`
- ID: `kubeconfig`

### 7. Create the pipeline job

1. **New Item > Pipeline**
2. Under **Pipeline**, set **Definition** to **Pipeline script from SCM**.
3. SCM: Git - point it at this repository.
4. Script path: `Jenkinsfile`
5. Save and click **Build Now**.

---

## Infrastructure Setup

Run Terraform and Ansible once before the first pipeline execution.

### Provision the staging namespace

```bash
cd iac/terraform
terraform init
terraform plan
terraform apply
```

This creates the `kijani-staging` namespace with `managed-by: terraform` labels. The default context is `minikube`.

### Configure the staging namespace

```bash
pip install ansible-core kubernetes
ansible-galaxy collection install kubernetes.core

ansible-playbook iac/ansible/staging-config.yml
```

This applies the staging ConfigMap, Service, ResourceQuota, and LimitRange to `kijani-staging`.

---

## Bootstrap the Cluster

After Terraform and Ansible, run the bootstrap script once to apply all remaining manifests:

```bash
bash scripts/bootstrap.sh
```

The script is idempotent - safe to re-run. Verify the deployments:

```bash
kubectl get pods -n default
kubectl get pods -n kijani-staging
```

---

## Pipeline Stages

| #   | Stage                 | Agent     | What it does                                                                                                                                                     |
| --- | --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Setup                 | `node:24` | Reads version from `package.json`, appends short Git SHA to form `IMAGE_TAG`.                                                                                    |
| 2   | Lint                  | `node:24` | `npm ci` + `npm run lint` (ESLint).                                                                                                                              |
| 3   | Test                  | `node:24` | `npm test` (Jest). Publishes JUnit results.                                                                                                                      |
| 4   | Build                 | `node:24` | `npm run build` to `dist/`. Stashes build output.                                                                                                                |
| 5   | Build and Push Images | host      | `docker build` + push for both `erickmosedev/kk-payments:<IMAGE_TAG>` and `erickmosedev/receipt-handler:latest` to Docker Hub.                                   |
| 6   | Security Audit        | `node:24` | `npm audit --audit-level=high`. Archives the report.                                                                                                             |
| 7   | Deploy to Staging     | host      | `kubectl apply` ConfigMap + Service + Deployment for kk-payments, then `kubectl set image` + rollout wait. Then deploys receipt-handler in the same namespace.   |
| 8   | Smoke Test            | host      | Hits `GET /health` and `POST /payments` on the staging NodePort. Pipeline stops here if either check fails. No approval prompt is shown if the smoke test fails. |
| 9   | Archive and Publish   | `node:24` | Archives `dist/` in Jenkins. Publishes the versioned package to Nexus.                                                                                           |
| 10  | Approval Gate         | none      | A human must approve before production is touched. This step is only reachable after the smoke test passes.                                                      |
| 11  | Deploy to Production  | host      | Same `kubectl apply` + `set image` + rollout wait, targeting the `default` namespace.                                                                            |

---

## Receipt Handler

When `kk-payments` creates a payment in staging, it POSTs a receipt payload to `RECEIPT_ENDPOINT` (set in the staging ConfigMap). The receipt handler writes `receipt-{paymentId}.json` to the `kk-payments-receipts` S3 bucket. That upload triggers the `processReceiptUpload` function via the S3 ObjectCreated event.

### Run locally

```bash
cd serverless/receipt-handler
npm install
mkdir -p /tmp/kijani-s3-local
npx sls offline start
```

Wait for both of these messages before uploading anything:

```
S3 local server ready
POST | http://localhost:3000/dev/receipts
```

### Fire the S3 trigger

**Option A - Node.js upload script (no aws CLI needed)**

```bash
node upload-test.js
```

**Option B - direct invoke (bypasses S3 entirely)**

```bash
npx sls invoke local --function processReceiptUpload --data '{
  "Records": [{
    "eventName": "ObjectCreated:Put",
    "eventTime": "2024-11-01T08:32:14.000Z",
    "s3": {
      "bucket": { "name": "kk-payments-receipts" },
      "object": { "key": "receipt-ORD-001.json", "size": 284 }
    }
  }]
}'
```

Expected output in Terminal 1:

```
{"event":"receipt_processed","bucketName":"kk-payments-receipts","objectKey":"receipt-ORD-001.json","objectSize":284,"orderId":"ORD-001","processedAt":"...","handler":"processReceiptUpload"}
[kk-receipts] Processing upload: bucket=kk-payments-receipts key=receipt-ORD-001.json size=284b
```

### Verify multi-record iteration

Pass two records to confirm both produce log lines:

```bash
npx sls invoke local --function processReceiptUpload --data '{"Records":[{"eventName":"ObjectCreated:Put","eventTime":"2024-11-01T08:00:00.000Z","s3":{"bucket":{"name":"kk-payments-receipts"},"object":{"key":"receipt-ORD-001.json","size":284}}},{"eventName":"ObjectCreated:Put","eventTime":"2024-11-01T08:00:01.000Z","s3":{"bucket":{"name":"kk-payments-receipts"},"object":{"key":"receipt-ORD-002.json","size":291}}}]}'
```

Two distinct log lines should appear. If only one appears, the handler is not iterating correctly.

### Deploy to the staging cluster

The Jenkins pipeline (stage 5) builds and pushes the receipt-handler image to Docker Hub, then stage 7 deploys it to `kijani-staging` automatically. No manual steps are needed after the first pipeline run.

If you need to redeploy manually outside the pipeline:

```bash
docker build -t erickmosedev/receipt-handler:latest serverless/receipt-handler/
docker push erickmosedev/receipt-handler:latest
kubectl apply -f serverless/receipt-handler/k8s-manifest.yaml
kubectl rollout restart deployment/receipt-handler -n kijani-staging
```

Check the pod comes up:

```bash
kubectl get pods -n kijani-staging -l app=receipt-handler
```

---

## Local Development

```bash
cd app/kijanikiosk-payment

npm install        # install dependencies
npm run dev        # start dev server with hot reload on port 3000
npm test           # run Jest tests
npm run lint       # ESLint
npm run build      # output to dist/
```

Health endpoint: `GET http://localhost:3000/health`

---

## Project Structure

```
kijanikiosk-capstone/
├── Jenkinsfile                                  # 11-stage CI/CD pipeline
├── README.md
├── app/
│   └── kijanikiosk-payment/
│       ├── Dockerfile.production                # Multi-stage production image
│       ├── package.json
│       ├── src/
│       │   ├── app.js                           # Express routes + writeReceipt()
│       │   └── server.js                        # HTTP server entry point
│       └── test/
│           └── payment.test.js
├── docs/
│   └── project-scope.md
├── iac/
│   ├── terraform/
│   │   ├── main.tf                              # Provisions kijani-staging namespace
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── ansible/
│       └── staging-config.yml                   # ConfigMap, quota, LimitRange
├── k8s/
│   ├── kk-payments-deployment.yaml              # Shared manifest (no namespace set)
│   ├── kk-payments-configmap-prod.yaml          # Production config values
│   ├── kk-payments-configmap-staging.yaml       # Staging config + RECEIPT_ENDPOINT
│   ├── kk-payments-service-prod.yaml            # NodePort :30000
│   └── kk-payments-service-staging.yaml         # NodePort :30001
├── observability/
│   └── alert-rules.yaml                         # 3 Prometheus alert rules
├── screenshots/                                 # Evidence - replace placeholders after runs
│   ├── pipeline-run-pass.txt
│   ├── pipeline-run-fail-smoke.txt
│   ├── alert-firing.txt
│   └── receipt-chain-log.txt
├── scripts/
│   └── bootstrap.sh                             # One-time cluster bootstrap
└── serverless/
    └── receipt-handler/
        ├── serverless.yml                       # 3 functions: health, generateReceipt, processReceiptUpload
        ├── handler.js                           # Lambda-style handlers
        ├── upload-test.js                       # Trigger the S3 event without the aws CLI
        ├── package.json
        ├── Dockerfile                           # Runs sls offline start
        └── k8s-manifest.yaml                   # Deployment + Service in kijani-staging
```
