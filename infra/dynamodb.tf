# Where rate-limit counters live once more than one thing is counting.
#
# This is not a precaution. On Lambda the in-memory default is not a weaker
# limit, it is close to no limit at all: every concurrent request gets its own
# execution environment, and each one starts its counter at zero. Ten
# simultaneous attempts against /auth/login — declared as 5 per minute —
# were all answered, none throttled, against this very deployment. Sequential
# requests reuse a warm environment and are limited correctly, which is what
# makes the gap easy to miss: nobody brute-forces sequentially.
resource "aws_dynamodb_table" "throttler" {
  name         = "${var.project}-throttler"
  billing_mode = "PROVISIONED"
  hash_key     = "pk"

  # 25 read and 25 write units is the always-free allowance, and it is a
  # per-account, per-region pool — no other table in this account uses any of
  # it. Each request costs one strongly consistent read and one write, so this
  # covers 25 requests a second before DynamoDB itself starts throttling. Well
  # past what this service sees, and if it were ever exceeded the storage
  # fails open rather than failing the request.
  #
  # On-demand would scale further and is not in the free tier at all.
  read_capacity  = 25
  write_capacity = 25

  attribute {
    name = "pk"
    type = "S"
  }

  # Garbage collection, never the clock. AWS deletes expired items "typically
  # within two days" and keeps serving them in reads until it does, so a
  # 60-second window enforced by TTL would not be a window. The application
  # compares windowEndsAt inside the item; this only stops the table growing
  # without bound.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # The counters are worth nothing a moment after they expire, so there is
  # nothing here to recover to a point in time.
  point_in_time_recovery {
    enabled = false
  }
}

# The function may read and write its own counters and nothing else. Two verbs,
# because the storage does exactly two things: a strongly consistent GetItem
# and a conditional PutItem.
data "aws_iam_policy_document" "lambda_throttler" {
  statement {
    sid       = "CountRequestsAgainstItsOwnTable"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.throttler.arn]
  }
}

resource "aws_iam_role_policy" "lambda_throttler" {
  name   = "${var.project}-lambda-throttler"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_throttler.json
}

output "throttler_table" {
  description = "Set as THROTTLER_DDB_TABLE for the counters to be shared. Unset, the app counts per execution environment and says so at boot."
  value       = aws_dynamodb_table.throttler.name
}
