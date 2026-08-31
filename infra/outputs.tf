data "aws_caller_identity" "current" {}

output "provisioning_identity" {
  description = "Who Terraform is acting as. Should be an assumed-role ARN — if it ever reads as a user or the account root, the assume_role wiring has come undone and the blast radius is no longer what this configuration claims."
  value       = data.aws_caller_identity.current.arn
}

output "ecr_repository_url" {
  description = "Push target for the Lambda container image built by Dockerfile.lambda."
  value       = aws_ecr_repository.api.repository_url
}

output "lambda_function_url" {
  description = "Publicly resolvable, by necessity — a function URL behind CloudFront cannot use origin access control without breaking every browser POST. EDGE_SHARED_SECRET is what makes reaching it directly useless."
  value       = aws_lambda_function_url.api.function_url
}

output "lambda_execution_role_arn" {
  description = "The identity the function runs as. It reads its own parameters and signs uploads for one bucket; nothing else."
  value       = aws_iam_role.lambda.arn
}
