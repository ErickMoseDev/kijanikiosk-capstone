#!/usr/bin/env bash
# scripts/bootstrap.sh
#
# One-time cluster bootstrap — applies all Kubernetes manifests for both
# environments and deploys the receipt-handler into kijani-staging.
#
# Run this once against a fresh cluster BEFORE triggering the Jenkins pipeline.
# After bootstrap, the pipeline manages image updates via `kubectl set image`.
#
# Prerequisites: kubectl configured and pointing at the correct cluster.
# Usage: bash scripts/bootstrap.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S="${ROOT}/k8s"
SERVERLESS="${ROOT}/serverless/receipt-handler"

echo "======================================================"
echo " KijaniKiosk cluster bootstrap"
echo "======================================================"

# Create staging namespace (idempotent) 
echo ""
echo "--- Creating kijani-staging namespace ---"
kubectl create namespace kijani-staging --dry-run=client -o yaml | kubectl apply -f -

# Production: ConfigMap → Service → Deployment 
echo ""
echo "--- Bootstrapping production (default namespace) ---"
kubectl apply -f "${K8S}/kk-payments-configmap-prod.yaml"
kubectl apply -f "${K8S}/kk-payments-service-prod.yaml"
kubectl apply -f "${K8S}/kk-payments-deployment.yaml" -n default

# Staging: ConfigMap → Service → Deployment 
echo ""
echo "--- Bootstrapping staging (kijani-staging namespace) ---"
kubectl apply -f "${K8S}/kk-payments-configmap-staging.yaml"
kubectl apply -f "${K8S}/kk-payments-service-staging.yaml"
kubectl apply -f "${K8S}/kk-payments-deployment.yaml" -n kijani-staging

# Receipt handler (staging only) 
echo ""
echo "--- Deploying receipt-handler into kijani-staging ---"
kubectl apply -f "${SERVERLESS}/k8s-manifest.yaml"

# Observability (if monitoring namespace exists) 
if kubectl get namespace monitoring &>/dev/null; then
    echo ""
    echo "--- Applying Prometheus alert rules ---"
    kubectl apply -f "${ROOT}/observability/alert-rules.yaml"
else
    echo ""
    echo "SKIP: 'monitoring' namespace not found — apply alert-rules.yaml after Prometheus is installed."
fi

echo ""
echo "======================================================"
echo " Bootstrap complete"
echo " Production : http://<node-ip>:30000"
echo " Staging    : http://<node-ip>:30001"
echo "======================================================"
