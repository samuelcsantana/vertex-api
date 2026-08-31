variable "project" {
  description = "Name every resource is prefixed with. The provisioning role's policy is scoped to this prefix, so changing it here without changing the policy produces AccessDenied rather than a differently-named resource."
  type        = string
  default     = "vertex-api"
}

variable "aws_region" {
  description = "Where compute and data live. sa-east-1 because the Neon database is already there, and co-locating the two is the reason this migration exists at all."
  type        = string
  default     = "sa-east-1"
}

variable "provisioning_role_arn" {
  description = "Role Terraform assumes. Holds the permissions; the identity that runs Terraform holds only the right to assume it."
  type        = string
  default     = "arn:aws:iam::727050200735:role/vertex-api-terraform"
}

variable "image_retention_count" {
  description = "How many tagged container images ECR keeps. Lambda pulls by digest, so older images matter only for rolling back."
  type        = number
  default     = 10
}
