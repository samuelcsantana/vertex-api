data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# The function's own identity. Named with the project prefix because the
# provisioning role may only touch IAM roles called vertex-api-* — a different
# name here produces AccessDenied at apply time rather than a role.
resource "aws_iam_role" "lambda" {
  name               = "${var.project}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  description        = "Execution role for the ${var.project} Lambda function."
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid     = "ReadItsOwnConfiguration"
    effect  = "Allow"
    actions = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*",
    ]
  }

  statement {
    # SecureString parameters are encrypted with the account's default SSM key,
    # and reading one is two permissions rather than one: SSM hands back
    # ciphertext and KMS turns it into the value. Missing this half looks
    # exactly like a parameter that exists and is empty.
    sid       = "DecryptThoseParameters"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  statement {
    # Presigning is signing, so the URL handed to a browser can do exactly
    # what this role can do — no more. Scoped to the one bucket, and to the
    # two verbs the uploads module actually performs.
    sid       = "SignUploadsForTheMediaBucket"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.uploads_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.project}-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

# Created here rather than left to Lambda, which would make one on first
# invocation that never expires. Logs are the cheapest thing to accumulate
# forever and the easiest to forget.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.project}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name = var.project
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"

  # Matches the image, which is built --platform linux/amd64. A mismatch here
  # is not a performance question: the function simply fails to start.
  architectures = ["x86_64"]

  # Memory buys CPU on Lambda — they are the same dial — and a cold start of
  # a Nest application is bound by how fast it can execute its own module
  # graph, not by how much heap it holds. Paying for a shorter cold start is
  # the trade being made here, and the free tier is measured in GB-seconds, so
  # a faster function at more memory can cost the same or less.
  memory_size = var.memory_mb

  # CloudFront gives up on an origin after 30 seconds by default, so a longer
  # timeout here would only buy work nobody is still waiting for.
  timeout = 30

  environment {
    variables = {
      NODE_ENV = "production"

      # Everything else is read from Parameter Store at cold start. This is
      # the one variable that has to be here, because it is the one that says
      # where the others are.
      CONFIG_PARAMETER_PREFIX = "/${var.project}/"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]

  lifecycle {
    # Terraform owns the shape of the function; deploys own what runs in it.
    # Without this, every plan after a deploy would want to roll the image
    # back to whatever tag this configuration last resolved, and the rollback
    # would happen on some unrelated apply.
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  # NONE is not laziness and not a temporary state. Locking a function URL to
  # its distribution means origin access control, and OAC requires the caller
  # to send a SHA-256 of the request body in x-amz-content-sha256 — AWS's own
  # words are "Lambda doesn't support unsigned payloads". A browser doing
  # fetch cannot produce that, so every POST from the site would fail: login,
  # registration, the OAuth exchange, posting a comment.
  #
  # What keeps this URL from being an open back door is EDGE_SHARED_SECRET:
  # the CDN sends a header only it knows, and EdgeOriginGuard answers 403 to
  # anything arriving without it. That guard is the reason this line is safe,
  # so the two must ship together.

  # CORS is deliberately not configured here. The app already answers it, from
  # FRONTEND_URL and its www variant, and a second answer at the function URL
  # would be a second place to keep in sync for no gain.
}
