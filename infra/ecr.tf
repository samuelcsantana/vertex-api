# Where the Lambda container image built by Dockerfile.lambda is pushed.
#
# It comes first because everything else waits on it: a Lambda backed by a
# container image cannot be created pointing at an image that does not exist
# yet, so the repository and a first push have to precede the function.
resource "aws_ecr_repository" "api" {
  name = var.project

  # Tags stay mutable so a deploy can move :latest, which is what the GitHub
  # Actions workflow will do. Nothing depends on a tag being immutable here
  # because Lambda resolves the image to a digest when the function is
  # updated and keeps running that digest — retagging afterwards cannot
  # silently change what is deployed.
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  # Two rules, and the order is the whole point: ECR applies them by priority
  # and an image is only ever matched by the first rule that catches it.
  #
  # Untagged images are the layers a re-push orphans. They are worth nothing
  # after a day and would otherwise accumulate forever inside the 500 MB free
  # tier.
  #
  # Tagged images are rollback targets, so a handful is kept. Lambda pins the
  # digest it runs, which means expiring an old tag cannot break a running
  # function — only the ability to go back to it.
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after a day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last ${var.image_retention_count} tagged images as rollback targets"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.image_retention_count
        }
        action = { type = "expire" }
      },
    ]
  })
}
