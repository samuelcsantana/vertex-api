terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State lives in S3, in the same region as everything it describes.
  #
  # The bucket is the one thing here that cannot be created by this
  # configuration: Terraform needs somewhere to keep state before it has run,
  # so it was created out of band — versioned, encrypted, public access
  # blocked, and with a bucket policy refusing anything that is not over TLS.
  # It is deliberately not imported: a state file that can destroy the bucket
  # holding it is a loop nobody wants to be in at 2am.
  #
  # use_lockfile is S3's own conditional-write locking, which replaced the
  # separate DynamoDB lock table. One less resource, and one less way for the
  # lock and the state to disagree.
  backend "s3" {
    bucket       = "vertex-api-tfstate-727050200735"
    key          = "vertex-api/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true

    # Terraform does the assuming rather than the caller. Locally the ambient
    # credentials are the vertex-api-deployer user, whose only permission is
    # to assume this role; in CI they will be a GitHub OIDC identity with the
    # same single permission. Either way the permissions live on the role, and
    # nothing long-lived holds them.
    assume_role = {
      role_arn     = "arn:aws:iam::727050200735:role/vertex-api-terraform"
      session_name = "terraform-backend"
    }
  }
}
