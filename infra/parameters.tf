locals {
  # Names, never values. Terraform creates each parameter with a placeholder
  # and then stops looking at it — see the lifecycle block below — so nothing
  # here and nothing in the state file is a copy of a secret. Whoever holds
  # the real value writes it once, out of band.
  secret_parameters = [
    "DATABASE_URL",
    "JWT_SECRET",
    "COOKIE_SECRET",
    "EDGE_SHARED_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "RESEND_API_KEY",
  ]
}

resource "aws_ssm_parameter" "secret" {
  for_each = toset(local.secret_parameters)

  name  = "/${var.project}/${each.key}"
  type  = "SecureString"
  value = "placeholder-set-the-real-value-out-of-band"

  description = "Read at cold start by the function. Terraform owns that this exists and never what it contains."

  lifecycle {
    # The whole point. Without it, every plan would want to reset each of
    # these to the placeholder above, and the first careless apply would
    # take the service down with configuration that looks present and is not.
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "config" {
  for_each = var.plain_parameters

  name  = "/${var.project}/${each.key}"
  type  = "String"
  value = each.value

  description = "Not a secret. Managed here, so a change is a diff someone reviews rather than a console edit nobody sees."
}
