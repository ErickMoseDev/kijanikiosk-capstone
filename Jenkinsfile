// ─────────────────────────────────────────────────────────────────────────────
// KijaniKiosk Capstone Pipeline
//
// Stages:  Setup → Lint → Test → Build → Build & Push Images → Security Audit
//          → Deploy — Staging → Smoke Test → Archive & Publish
//          → Approval Gate → Deploy — Production
//
// Required Jenkins credentials:
//   dockerhub-credentials  (Username / Password — Docker Hub)
//   nexus-credentials      (Username / Password — Nexus npm registry)
//   kubeconfig             (Secret file — ~/.kube/config for the cluster)
//
// Required tools on the Jenkins host agent:
//   docker  kubectl  curl
// ─────────────────────────────────────────────────────────────────────────────
pipeline {
    agent none

    environment {
        APP_DIR      = 'app/kijanikiosk-payment'
        APP_NAME     = 'kk-payments'
        BUILD_DIR    = 'dist'
        DOCKER_REPO           = 'erickmosedev/kk-payments'
        RECEIPT_HANDLER_REPO  = 'erickmosedev/receipt-handler'
        STAGING_NS            = 'kijani-staging'
        PROD_NS      = 'default'
        STAGING_PORT = '30001'
        NEXUS_URL    = 'http://nexus:8081'
    }
    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    stages {

        // ── 1. Setup ────────────────────────────────────────────────────────
        stage('Setup') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                script {
                    env.PKG_VERSION = sh(
                        script: "node -e \"process.stdout.write(require('./${APP_DIR}/package.json').version)\"",
                        returnStdout: true
                    ).trim()
                    env.GIT_SHORT  = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.IMAGE_TAG  = "${env.PKG_VERSION}-${env.GIT_SHORT}"
                    env.FULL_IMAGE = "${DOCKER_REPO}:${env.IMAGE_TAG}"
                    echo "Image: ${env.FULL_IMAGE}"
                }
            }
        }

        // ── 2. Lint ─────────────────────────────────────────────────────────
        stage('Lint') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                dir(APP_DIR) {
                    sh 'npm ci --prefer-offline'
                    sh 'npm run lint'
                }
            }
        }

        // ── 3. Test ─────────────────────────────────────────────────────────
        stage('Test') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                dir(APP_DIR) {
                    sh 'npm ci --prefer-offline'
                    sh 'npm test'
                }
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: '**/test-results/*.xml'
                }
            }
        }

        // ── 4. Build dist/ ──────────────────────────────────────────────────
        stage('Build') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                dir(APP_DIR) {
                    sh 'npm ci --prefer-offline'
                    sh 'npm run build'
                    sh '''
                    set -e
                    test -d "${BUILD_DIR}" || { echo "ERROR: build dir not found"; exit 1; }
                    count=$(ls "${BUILD_DIR}" | wc -l)
                    test "$count" -gt 0 || { echo "ERROR: build dir empty"; exit 1; }
                    echo "${count} files in ${BUILD_DIR}/"
                    '''
                    stash name: 'build-output', includes: "${BUILD_DIR}/**"
                }
            }
        }

        // ── 5. Build & push Docker images ────────────────────────────────────
        //    Builds kk-payments and receipt-handler; pushes both to Docker Hub.
        //    Requires Docker CLI on the Jenkins host agent.
        stage('Build & Push Images') {
            agent any
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh '''
                    set -e
                    echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin

                    echo "=== kk-payments ==="
                    docker build \
                      --label "git.sha=${GIT_SHORT}" \
                      --label "build.number=${BUILD_NUMBER}" \
                      -t "${FULL_IMAGE}" \
                      -f ${APP_DIR}/Dockerfile.production ${APP_DIR}
                    docker push "${FULL_IMAGE}"
                    docker tag  "${FULL_IMAGE}" "${DOCKER_REPO}:latest"
                    docker push "${DOCKER_REPO}:latest"

                    echo "=== receipt-handler ==="
                    docker build -t "${RECEIPT_HANDLER_REPO}:latest" serverless/receipt-handler/
                    docker push "${RECEIPT_HANDLER_REPO}:latest"

                    docker logout
                    '''
                }
            }
        }

        // ── 6. Security audit ───────────────────────────────────────────────
        stage('Security Audit') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                dir(APP_DIR) {
                    sh '''#!/bin/bash
set -o pipefail
npm audit --audit-level=high 2>&1 | tee audit-report.txt
'''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: '**/audit-report.txt', allowEmptyArchive: true
                }
            }
        }

        // ── 7. Deploy to staging ────────────────────────────────────────────
        //    Requires kubectl on the Jenkins host agent.
        stage('Deploy — Staging') {
            agent any
            steps {
                withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
                    sh '''
                    set -e
                    echo "=== Applying manifests to ${STAGING_NS} ==="
                    kubectl apply -f k8s/kk-payments-configmap-staging.yaml
                    kubectl apply -f k8s/kk-payments-service-staging.yaml
                    kubectl apply -f k8s/kk-payments-deployment.yaml -n ${STAGING_NS}

                    echo "=== Updating image to ${FULL_IMAGE} ==="
                    kubectl set image deployment/${APP_NAME} \
                      ${APP_NAME}=${FULL_IMAGE} -n ${STAGING_NS}

                    echo "=== Waiting for kk-payments rollout ==="
                    kubectl rollout status deployment/${APP_NAME} \
                      -n ${STAGING_NS} --timeout=120s

                    echo "=== Deploying receipt-handler to ${STAGING_NS} ==="
                    kubectl apply -f serverless/receipt-handler/k8s-manifest.yaml
                    kubectl set image deployment/receipt-handler \
                      receipt-handler=${RECEIPT_HANDLER_REPO}:latest -n ${STAGING_NS}
                    kubectl rollout status deployment/receipt-handler \
                      -n ${STAGING_NS} --timeout=120s
                    '''
                }
            }
        }

        // ── 8. Smoke test ───────────────────────────────────────────────────
        //    Requires curl on the Jenkins host agent.
        //    Fails the pipeline before the approval gate is offered.
        stage('Smoke Test') {
            agent any
            steps {
                withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
                    sh '''
                    set -e
                    NODE_IP=$(kubectl get nodes \
                      -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
                    BASE="http://${NODE_IP}:${STAGING_PORT}"
                    echo "Smoke test target: ${BASE}"

                    echo "--- /health ---"
                    HEALTH=$(curl -sf --max-time 5 "${BASE}/health")
                    echo "${HEALTH}" | grep -q '"ok"' \
                      || { echo "SMOKE FAIL: /health did not return ok"; exit 1; }

                    echo "--- POST /payments ---"
                    PAYMENT=$(curl -sf --max-time 5 -X POST "${BASE}/payments" \
                      -H 'Content-Type: application/json' \
                      -d '{"amount":1,"currency":"KES","method":"mpesa"}')
                    echo "${PAYMENT}" | grep -q '"status":"pending"' \
                      || { echo "SMOKE FAIL: POST /payments did not return pending"; exit 1; }

                    echo "=== Smoke test PASSED ==="
                    '''
                }
            }
        }

        // ── 9. Archive build artifact + publish to Nexus npm registry ───────
        stage('Archive & Publish') {
            agent { docker { image 'node:24'; args '--network shared-net' } }
            steps {
                dir(APP_DIR) {
                    unstash 'build-output'
                    archiveArtifacts artifacts: "${BUILD_DIR}/**",
                                     fingerprint: true,
                                     onlyIfSuccessful: true
                    withCredentials([usernamePassword(
                        credentialsId: 'nexus-credentials',
                        usernameVariable: 'NEXUS_USER',
                        passwordVariable: 'NEXUS_PASS'
                    )]) {
                        sh """
set -e
NEXUS_TOKEN=\$(echo -n "\${NEXUS_USER}:\${NEXUS_PASS}" | base64)
NEXUS_HOST=\$(echo "\${NEXUS_URL}" | sed 's|https\\?://||')
trap "rm -f .npmrc" EXIT
cat > .npmrc << NPMRC
registry=\${NEXUS_URL}/repository/capstone-kijanikiosk/
//\${NEXUS_HOST}/repository/capstone-kijanikiosk/:_auth=\${NEXUS_TOKEN}
//\${NEXUS_HOST}/repository/capstone-kijanikiosk/:always-auth=true
NPMRC
npm version "\${IMAGE_TAG}" --no-git-tag-version
npm publish --tag build
"""
                    }
                }
            }
        }

        // ── 10. Human approval gate ─────────────────────────────────────────
        //     Only reachable after the smoke test passes.
        stage('Approval Gate') {
            agent none
            steps {
                timeout(time: 24, unit: 'HOURS') {
                    input message: "Deploy ${APP_NAME}:${env.IMAGE_TAG} to production?",
                          ok: 'Approve and deploy',
                          submitter: 'admin'
                }
            }
        }

        // ── 11. Deploy to production ────────────────────────────────────────
        stage('Deploy — Production') {
            agent any
            steps {
                withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
                    sh '''
                    set -e
                    echo "=== Applying manifests to production (${PROD_NS}) ==="
                    kubectl apply -f k8s/kk-payments-configmap-prod.yaml
                    kubectl apply -f k8s/kk-payments-service-prod.yaml
                    kubectl apply -f k8s/kk-payments-deployment.yaml -n ${PROD_NS}

                    echo "=== Updating image to ${FULL_IMAGE} ==="
                    kubectl set image deployment/${APP_NAME} \
                      ${APP_NAME}=${FULL_IMAGE} -n ${PROD_NS}

                    echo "=== Waiting for rollout ==="
                    kubectl rollout status deployment/${APP_NAME} \
                      -n ${PROD_NS} --timeout=120s

                    echo "=== Production deployment complete ==="
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "Pipeline PASSED: ${APP_NAME} ${env.IMAGE_TAG} deployed to production"
        }
        failure {
            echo "Pipeline FAILED: ${APP_NAME} build ${BUILD_NUMBER} — review ${BUILD_URL}console"
        }
        changed {
            echo "Status changed to ${currentBuild.currentResult} — ${JOB_NAME} #${BUILD_NUMBER}"
        }
    }
}
