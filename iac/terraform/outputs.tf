output "staging_namespace" {
  description = "The name of the provisioned staging namespace"
  value       = kubernetes_namespace.kijani_staging.metadata[0].name
}
