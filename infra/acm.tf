# The certificate for the custom domain, and the one resource in this
# configuration that cannot live in sa-east-1 with everything else.
#
# CloudFront reads certificates from us-east-1 and only from us-east-1,
# whatever region the distribution serves or its origin runs in. A certificate
# issued elsewhere is not rejected at plan time or at apply time: it is simply
# invisible to CloudFront, and the failure appears at the end, as a
# distribution that will not accept the alias.
resource "aws_acm_certificate" "api" {
  provider = aws.us_east_1

  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    # A certificate in use by a distribution cannot be deleted, so any change
    # that replaces it has to bring the new one up first.
    create_before_destroy = true
  }
}

# DNS for this domain is not in Route 53 — it is at the registrar the frontend
# already uses — so the validation record is created by hand there rather than
# by Terraform. This resource does nothing but wait for that record to exist
# and for ACM to see it.
resource "aws_acm_certificate_validation" "api" {
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.api.arn

  timeouts {
    create = "30m"
  }
}

output "certificate_validation_record" {
  description = "The CNAME to create wherever this domain's DNS lives. Until it resolves, the certificate stays PENDING_VALIDATION and the distribution cannot use the alias."
  value = {
    for option in aws_acm_certificate.api.domain_validation_options :
    option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }
}
