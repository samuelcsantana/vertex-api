data "aws_caller_identity" "current" {}

output "provisioning_identity" {
  description = "Who Terraform is acting as. Should be an assumed-role ARN — if it ever reads as a user or the account root, the assume_role wiring has come undone and the blast radius is no longer what this configuration claims."
  value       = data.aws_caller_identity.current.arn
}

output "ecr_repository_url" {
  description = "Push target for the Lambda container image built by Dockerfile.lambda."
  value       = aws_ecr_repository.api.repository_url
}
