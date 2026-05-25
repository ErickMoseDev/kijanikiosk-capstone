terraform {
  required_version = ">= 1.6"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context != "" ? var.kube_context : null
}

#  Staging namespace
resource "kubernetes_namespace" "kijani_staging" {
  metadata {
    name = var.staging_namespace

    labels = {
      environment = "staging"
      managed-by  = "terraform"
      project     = "kijanikiosk"
    }
  }
}
