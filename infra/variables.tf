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

variable "image_tag" {
  description = "Tag Terraform points the function at when it first creates it. Deploys move the image afterwards and Terraform stops looking — see the lifecycle block on aws_lambda_function."
  type        = string
  default     = "latest"
}

variable "memory_mb" {
  description = "Memory, which on Lambda is also CPU. Cold start of a Nest app is bound by CPU, and billing is in GB-seconds, so more memory can finish sooner for the same money."
  type        = number
  default     = 1024
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps this function's logs. Left to Lambda it would be forever."
  type        = number
  default     = 14
}

variable "uploads_bucket" {
  description = "S3 bucket the uploads module presigns against. Already exists and is not managed here — it holds live media for the site."
  type        = string
  default     = "blog-dev-apps"
}

variable "plain_parameters" {
  description = "Configuration that is not secret, managed in Parameter Store so a change is a reviewed diff rather than a console edit nobody sees. Secrets are declared by name only, in parameters.tf."
  type        = map(string)
  default = {
    AWS_S3_BUCKET_NAME = "blog-dev-apps"
    FRONTEND_URL       = "https://samuelsantana.dev"

    # Sender for the passwordless sign-in mail. Required at boot: without it
    # ResendEmailSender throws and the function never finishes starting.
    OTP_EMAIL_FROM = "no-reply@samuelsantana.dev"

    # The one address that becomes an admin on first sign-in. Deliberately an
    # address nobody owns, so an unfinished deployment cannot hand the admin
    # role to anyone by accident.
    ADMIN_EMAIL = "placeholder@example.com"

    # Registered with each provider, and pointing at the domain this service
    # will answer on rather than at the function URL — changing them later
    # means editing the Google and GitHub consoles, so they are written once
    # for where this is going.
    GOOGLE_CALLBACK_URL = "https://api.samuelsantana.dev/auth/google/callback"
    GITHUB_CALLBACK_URL = "https://api.samuelsantana.dev/auth/github/callback"
  }
}

variable "api_domain" {
  description = "Domain this service answers on. A Lambda function URL cannot carry a custom domain by itself, which is the reason CloudFront is in front of it at all."
  type        = string
  default     = "api.samuelsantana.dev"
}
