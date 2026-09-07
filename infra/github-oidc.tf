# Lets the deploy workflow authenticate as a role in this account without a
# long-lived access key living in the repository's secrets. GitHub signs a
# short-lived token per run, AWS verifies it against the OIDC provider, and the
# credentials expire with the job.

# Referenced, not created. The provisioning role may read OIDC providers
# (iam:GetOpenIDConnectProvider, iam:ListOpenIDConnectProviders) and cannot
# create one — iam:CreateOpenIDConnectProvider is deliberately absent from its
# policy, which is scoped to vertex-api* and an OIDC provider is account-wide.
# So the provider is registered out of band, once, the same way the state
# bucket is: see docs/PLANO-deploy-automatizado.md. A plan against an account
# without it fails here, by name, instead of somewhere less obvious.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # Without this, any GitHub repository in the world could assume the role —
    # the provider vouches that a token came from GitHub Actions, nothing more.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringEquals against one full subject rather than StringLike against
    # `repo:owner/name:*`. The wildcard form also matches pull_request runs,
    # which is how a fork's PR gets to deploy: the workflow file it proposes
    # is the workflow that runs. Pinned to main, a proposed change to the
    # deploy has to be merged before it can reach the account.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
  description        = "Assumed by the ${var.project} deploy workflow to push an image and move the function to it."

  # An hour is the ceiling a deploy could ever need; the SDK asks for less.
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    # Cannot be scoped to a repository: the token is what authorises the
    # registry as a whole, and the push verbs below are what decide where the
    # layers may land.
    sid       = "LogInToTheRegistry"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    # Exactly the verbs `docker push` performs, and no delete: a workflow that
    # can remove images can also remove the tag a rollback would target. The
    # lifecycle policy is what expires images here, not the deploy.
    sid    = "PushImagesForThisService"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [aws_ecr_repository.api.arn]
  }

  statement {
    # UpdateFunctionCode is the deploy. GetFunction is how the workflow waits
    # for it to finish and then reports what is actually running — without it
    # the job would go green on the API call being accepted, which is not the
    # same as the function having the new image.
    sid    = "MoveTheFunctionToTheNewImage"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = [aws_lambda_function.api.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.project}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
