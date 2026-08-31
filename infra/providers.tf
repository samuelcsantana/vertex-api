provider "aws" {
  region = var.aws_region

  # Same reasoning as the backend's assume_role: whatever identity runs
  # Terraform is allowed to assume this role and nothing else, so a leaked
  # credential is worth an hour of a scoped role rather than an account.
  assume_role {
    role_arn     = var.provisioning_role_arn
    session_name = "terraform"
  }

  default_tags {
    tags = {
      project    = var.project
      managed-by = "terraform"
    }
  }
}

# CloudFront reads certificates from us-east-1 and only from us-east-1,
# regardless of where the distribution serves or where its origin lives. That
# is not a preference this configuration can express differently: an ACM
# certificate created in sa-east-1 is invisible to CloudFront, the plan
# applies cleanly, and the custom domain is rejected at the end. Hence a
# second provider whose only job is to hold that one resource.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  assume_role {
    role_arn     = var.provisioning_role_arn
    session_name = "terraform"
  }

  default_tags {
    tags = {
      project    = var.project
      managed-by = "terraform"
    }
  }
}
