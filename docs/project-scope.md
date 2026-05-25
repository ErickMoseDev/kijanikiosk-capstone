# KijaniKiosk Capstone Project Scope

**Track A: Infrastructure-First**
**Author:** Erick Mong'are
**Date:** May 24th, 2026

## Problem Statement

Ten weeks ago, KijaniKiosk had no automated pipeline, no Infrastructure as Code, no containers, and no way to detect problems in production before customers reported them. Every deployment was a manual, undocumented process. Every environment was configured by hand, which meant no two environments were identical and no one could explain exactly how production got into its current state.

Over the course of this program, the team built each missing layer one week at a time using the same codebase and the same production standards throughout. The result is a system that can deploy the payment service automatically, recover from failures without human intervention, and demonstrate through collected evidence that it works the way it is described.

The capstone answers one final question: can the system be extended to the point where a new engineer can pick it up, understand it, and contribute to it within a day?

That is the bar Nia set. It is also the bar this project is designed to meet.

## Track

**Track A: Infrastructure-First**

This track extends the KijaniKiosk deployment into a multi-environment, monitored, production-approaching system. The focus is on Infrastructure as Code, pipeline automation, observability, and serverless integration.

## In-Scope Components

### 1. Staging Namespace Provisioned by Terraform and Configured by Ansible

Terraform provisions the `kijani-staging` Kubernetes namespace using the Kubernetes provider, declaring it as managed infrastructure the same way it would declare any other resource. Ansible then applies the environment-specific configuration to that namespace: the ConfigMaps, the secrets structure, and any namespace-level resource limits. The staging namespace is isolated from the default production namespace. A change to staging cannot affect production, and a failure in staging does not take down production.

This extends the Terraform and Ansible work from Week 4, which provisioned and configured the host. The same tools now manage Kubernetes resources inside the cluster.

### 2. Jenkins Pipeline with Staging Deployment, Smoke Test, and Production Gate

The Week 5 pipeline built and published a versioned image. The capstone pipeline does more:

- On every merge to main, the pipeline deploys the new image to the `kijani-staging` namespace automatically.
- After the staging deployment completes, the pipeline runs a smoke test against the staging deployment. The smoke test calls the `/health` endpoint and the `POST /payments` endpoint with a known test payload and checks that both return expected responses.
- The production approval gate is only available after the smoke test passes. A human must approve before the pipeline deploys to production.
- If the smoke test fails, the pipeline stops. Nothing reaches production.

### 3. kk-payments in Staging with Environment-Specific ConfigMaps

The `kk-payments` Deployment manifest is the same file used for both staging and production. Environment-specific values (DB_HOST, NODE_ENV, and bucket name) are injected through ConfigMaps rather than baked into the image or the manifest. Staging and production ConfigMaps have different values. The Deployment reads from the ConfigMap at runtime.

### 4. Prometheus Alert Rule on a kk-payments Health Signal

At least one Prometheus alerting rule committed to the repository. The alert fires on one of the following signals:

- Payment error rate (5xx rate on `POST /payments`) exceeds 1% over a 5-minute window
- Pod restart count for kk-payments exceeds 3 restarts in a 10-minute window
- p95 latency on `POST /payments` exceeds 2,000 ms over a 5-minute window

These thresholds are derived from the SLOs defined in Week 7. The alert rule is stored in the repository alongside the Deployment manifest so that the monitoring configuration is version-controlled and auditable.

### 5. Serverless Receipt Chain in Staging

From Week 10: when `kk-payments` in the staging environment processes a payment, it writes a receipt record to the `kk-payments-receipts-staging` object storage bucket. A serverless function is triggered by new objects in that bucket. The function processes the receipt and confirms the chain fired correctly. Evidence of a successful receipt chain execution is collected and committed to the repository.

## Out-of-Scope Items

**Multi-node cluster.** The cluster is single-node. Multi-node setup, node autoscaling, and managed Kubernetes services are not in scope.

**TLS termination and public ingress.** The service is not reachable from the internet and does not have a TLS certificate. Ingress configuration and certificate management are out of scope.

**Persistent storage for the payment service.** kk-payments does not use a persistent volume. Database configuration is referenced by environment variable but a live database backend is not provisioned as part of this capstone. DB_HOST is set correctly in each ConfigMap but the database itself is mocked for testing purposes.

**Formal SLA contracts.** The SLOs defined in Week 7 are internal targets. No formal service level agreements with external parties are in scope.

**Security scanning in the pipeline.** Container image vulnerability scanning and dependency auditing are not included in the capstone pipeline.

**Canary and progressive delivery.** Traffic splitting and weighted rollouts are not in scope. The deployment strategy remains a rolling update with a production approval gate.

**Responsible AI implementation.** Week 10 includes a section on Responsible AI in DevOps. This capstone documents the principles and identifies where AI tooling was used during the project, but does not implement an AI system.

## Success Criteria

The capstone is complete when all of the following are true and supported by evidence committed to the repository.

| Criterion                                                                                     | How It Is Verified                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `kijani-staging` namespace provisioned by Terraform and configured by Ansible                 | `terraform show` output shows the namespace resource; Ansible run log confirms ConfigMaps and secrets were applied                 |
| Staging ConfigMap has a different DB_HOST value than production ConfigMap                     | Both ConfigMap manifests are committed and the values differ                                                                       |
| The kk-payments Deployment manifest is a single file used in both environments                | One manifest file exists; environment differences come only from ConfigMaps                                                        |
| Jenkins pipeline deploys to staging automatically on merge to main                            | A successful pipeline run log showing the staging deployment step is committed                                                     |
| Smoke test runs after staging deployment and gates the production approval step               | Pipeline run log shows the smoke test stage and the approval prompt appearing only after it passes                                 |
| A failed smoke test stops the pipeline before the production gate is offered                  | A pipeline run log showing a failed smoke test and a stopped pipeline is committed                                                 |
| At least one Prometheus alert rule is committed to the repository                             | The alert rule file exists in the repository and the alert name and threshold are documented                                       |
| Alert rule fires on the correct signal under a simulated condition                            | Evidence (screenshot or log) of the alert firing during a test is committed                                                        |
| kk-payments in staging writes to `kk-payments-receipts-staging` on a payment                  | A log or bucket event record showing the write is committed                                                                        |
| The serverless function triggered by the bucket fires correctly                               | Function execution log showing the receipt chain completed is committed                                                            |
| A new engineer can follow the repository documentation and run the full pipeline within a day | The README covers prerequisites, cluster setup, Terraform commands, Ansible commands, and pipeline trigger steps in plain language |

---

## Architecture Diagram

```
Developer pushes to main
         |
         v
+----------------------------------+
|        Jenkins Pipeline          |
|                                  |
|  1. Setup (version + Git SHA)    |
|  2. Lint                         |
|  3. Test (Jest, JUnit results)   |
|  4. Build dist/                  |
|  5. Build + push image ----------+-----> Docker Hub
|  6. Security audit               |       erickmosedev/kk-payments:<tag>
|  7. Deploy to staging            |
|  8. Smoke test ----> FAIL: pipeline stops, no production gate offered
|  9. Archive + publish -----------+-----> Jenkins artifacts (dist/)
|                                  +-----> Nexus npm registry
| 10. Approval gate <------------- human reviews and approves
| 11. Deploy to production         |
+----------------------------------+

Kubernetes Cluster (minikube, single-node)
Namespace provisioned by Terraform, configured by Ansible
|
+-- Namespace: default (production)
|   |
|   +-- Deployment: kk-payments (2 replicas, RollingUpdate)
|   |   ConfigMap: kk-payments-config
|   |   NODE_ENV: production
|   |   DB_HOST: prod-db.internal
|   |
|   +-- Service: kk-payments (NodePort :30000)
|
+-- Namespace: kijani-staging
    |
    +-- Deployment: kk-payments (2 replicas, RollingUpdate)
    |   ConfigMap: kk-payments-config
    |   NODE_ENV: staging
    |   DB_HOST: staging-db.internal
    |   RECEIPT_ENDPOINT: http://receipt-handler.kijani-staging:3000/receipts
    |
    +-- Service: kk-payments (NodePort :30001)
    |
    +-- Deployment: receipt-handler (1 replica)
        Runs: sls offline start (HTTP :3000, local S3 :4569)

Observability (applied to staging and production namespaces)
|
+-- Prometheus (kube-prometheus-stack, namespace: monitoring)
    +-- Alert: KKPaymentsHighErrorRate          (5xx rate > 1% over 5m)
    +-- Alert: KKPaymentsPodRestartingTooOften  (restarts > 3 in 10m)
    +-- Alert: KKPaymentsHighP95Latency         (p95 > 2000ms over 5m)

Serverless Receipt Chain (staging environment)

kk-payments (staging)
    |
    | POST /payments processed
    v
writeReceipt() sends POST /receipts to receipt-handler
    |
    v
generateReceipt function (Serverless Framework, HTTP :3000)
    |
    | writes receipt-{paymentId}.json
    v
kk-payments-receipts bucket (serverless-s3-local, :4569)
    |
    | S3 ObjectCreated event
    v
processReceiptUpload function (Serverless Framework, S3 trigger)
    |
    v
Structured log recorded: { event, orderId, bucketName, objectKey, processedAt }
```

---

## Repository Structure After Capstone

```
kijanikiosk-capstone/
├── Jenkinsfile                            (full pipeline: build, stage, smoke test, gate, prod)
├── README.md                              (onboarding guide for new engineers)
├── app/
│   └── kijanikiosk-payment/
│       ├── Dockerfile.production          (multi-stage production image)
│       ├── package.json
│       ├── src/
│       │   ├── app.js
│       │   └── server.js
│       └── test/
│           └── payment.test.js
├── docs/
│   └── project-scope.md                   (this file)
├── iac/
│   ├── terraform/
│   │   ├── main.tf                        (provisions kijani-staging namespace via Kubernetes provider)
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── ansible/
│       └── staging-config.yml             (applies ConfigMaps, secrets, and resource limits to kijani-staging)
├── k8s/
│   ├── kk-payments-deployment.yaml        (shared manifest, both environments)
│   ├── kk-payments-configmap-prod.yaml    (production environment values)
│   └── kk-payments-configmap-staging.yaml (staging environment values)
├── observability/
│   └── alert-rules.yaml                   (Prometheus alert rules)
├── screenshots/
│   ├── pipeline-run-pass.txt
│   ├── pipeline-run-fail-smoke.txt
│   ├── alert-firing.png
│   └── receipt-chain-log.txt
├── scripts/
└── serverless/
    └── receipt-handler/                   (function triggered by bucket events)
```

---

## What Makes This Production-Approaching, Not Production-Ready

This capstone meets a production engineering bar for a learning environment. It does not claim to be production-ready in the sense that a team would use it to handle real customer payments today. The honest gaps are:

- The cluster is a single node. A hardware failure takes down both staging and production.
- There is no persistent storage. Restarting a pod loses any in-memory state.
- The smoke test payload uses mocked data, not a real payment transaction.
- The alert rules fire but there is no on-call rotation to receive them.
- Container image scanning is not part of the pipeline.

These gaps are documented here because Nia's standard is not a perfect system. It is a system that is honest about what it does and does not do, and that a new engineer can understand without having been in the room when it was built.
