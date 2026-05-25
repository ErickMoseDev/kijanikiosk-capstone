pipeline {
    agent {
        docker {
            image "node:24"
            args  '--network shared-net'
        }
    }

    environment {
        NODE_ENV  = 'test'
        BUILD_DIR = 'dist'
        APP_NAME  = 'kijanikiosk-payments'
        NEXUS_URL = 'http://nexus:8081'
    }
    options {
        timeout(time:10, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr:'10'))
        disableConcurrentBuilds()
    }

    stages {
        stage("Setup"){
            steps {
                script {

                    if(fileExists('package.json')){
                        env.APP_DIR = "."
                    }else if (fileExists('app/kijanikiosk-payment/package.json')){
                        env.APP_DIR = 'app/kijanikiosk-payment'
                    }else{
                        error 'package.json not found in workspace root or app/kijanikiosk-payment'
                    }

                    echo "App directory: ${env.APP_DIR}"

                    env.PKG_VERSION      = sh(
                            script: "node -e \"var p=require('./${env.APP_DIR}/package.json');process.stdout.write(p.version)\"",
                            returnStdout: true
                        ).trim()
                    env.GIT_SHORT        = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.ARTIFACT_VERSION = "${env.PKG_VERSION}-${env.GIT_SHORT}"
                    echo "Artifact version: ${env.ARTIFACT_VERSION}"
                }

            }
        }
        stage("Lint"){
            steps {
                dir(env.APP_DIR){
                    echo "Running Linter for ${APP_NAME}..."
                    sh 'npm ci --prefer-offline'
                    sh 'npm run lint'
                }
            }
        }

        stage("Build"){
            steps {
                dir(env.APP_DIR) {
                    echo "Installing dependencies for ${APP_NAME}..."
                    sh 'npm ci --prefer-offline'
                    echo 'Building application...'
                    sh 'npm run build'
                    echo 'Verifying build output...'
                    sh '''
                    set -e
                    test -d "${BUILD_DIR}" || { echo "ERROR: build directory not found"; exit 1; }
                    count=$(ls "${BUILD_DIR}" | wc -l)
                    test "$count" -gt 0 || { echo "ERROR: build directory is empty"; exit 1; }
                    echo "Build output: ${count} files in ${BUILD_DIR}/"
                    '''
                    stash name: 'build-output', includes: "${BUILD_DIR}/**"
                }
            }
        }

        stage("Verify"){
            parallel {
                stage("Test"){
                    steps {
                        dir(env.APP_DIR) {
                            unstash 'build-output'
                            echo "Running test suites for ${APP_NAME}..."
                            sh 'npm test'
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true,
                                testResults: '**/test-results/*.xml'
                        }
                    }
                }
                stage('Security Audit') {
                    steps {
                        dir(env.APP_DIR) {
                            echo 'Running dependency security audit...'
                            sh '''#!/bin/bash
set -o pipefail
npm audit --audit-level=high 2>&1 | tee audit-report.txt
'''
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: '**/audit-report.txt',
                                             allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        stage('Archive') {
            steps {
                dir(env.APP_DIR) {
                    echo "Archiving build artifact for ${APP_NAME} build ${BUILD_NUMBER}..."
                    archiveArtifacts artifacts: "${BUILD_DIR}/**",
                                     fingerprint: true,
                                     onlyIfSuccessful: true
                    echo "Artifact archived. Download from ${BUILD_URL}artifact/"
                }
            }
        }

        stage('Publish') {
            steps {
                dir(env.APP_DIR) {
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

npm version "\${ARTIFACT_VERSION}" --no-git-tag-version
npm publish --tag build
"""
                    }
                }
            }
        }
    }
    post{
        success {
            echo "Pipeline succeeded: ${APP_NAME} ${ARTIFACT_VERSION} published to ${NEXUS_URL}"
        }
        failure {
            echo "Pipeline FAILED: ${APP_NAME} build ${BUILD_NUMBER} - review logs at ${BUILD_URL}console"
        }
        changed {
            echo "Build status changed to ${currentBuild.currentResult} - ${JOB_NAME} #${BUILD_NUMBER}"
        }
        always {
            cleanWs()
        }
    }
}