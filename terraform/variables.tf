variable "aws_region" {
  description = "AWS region for the EKS cluster"
  type        = string
  default     = "eu-north-1"
}

variable "cluster_name" {
  description = "Unique EKS cluster name"
  type        = string
  default     = "voting-cluster"
}

variable "kubernetes_version" {
  description = "Supported EKS Kubernetes version; verify availability in your region before applying"
  type        = string
  default     = "1.34"
}

variable "admin_cidr" {
  description = "Your current public IPv4 address as a /32 CIDR, for EKS API access"
  type        = string
  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "Set admin_cidr to your public IPv4 address followed by /32."
  }
}

variable "node_instance_type" {
  type    = string
  default = "c7i-flex.large"
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "node_min_size" {
  type    = number
  default = 1
}

variable "node_max_size" {
  type    = number
  default = 2
}
