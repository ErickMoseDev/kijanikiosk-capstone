variable "kubeconfig_path" {
  description = "Absolute path to the kubeconfig file"
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "Kubernetes context name to use. Leave empty to use the current context."
  type        = string
  default     = "minikube"
}

variable "staging_namespace" {
  description = "Name of the staging namespace to provision"
  type        = string
  default     = "kijani-staging"
}
