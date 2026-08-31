# What reaches the origin, and it is a custom policy rather than a managed one
# for a single header.
#
# The managed AllViewer policy forwards everything a viewer sent and nothing
# CloudFront adds. That is a problem here because the rate limiter cannot use
# what the viewer sent: CloudFront *appends* to X-Forwarded-For rather than
# replacing it, so its leftmost entry — which is what request.ip resolves to —
# is a value the caller chose. CloudFront-Viewer-Address is CloudFront's own
# record of who it is answering, generated and overwritten by CloudFront, and
# it is the only address here that a caller cannot pick. Without it forwarded,
# the app falls back to the spoofable one and says so in its logs.
resource "aws_cloudfront_origin_request_policy" "all_viewer_and_address" {
  name    = "${var.project}-all-viewer-and-viewer-address"
  comment = "Everything the viewer sent, plus CloudFront's own record of the viewer's address, which is what per-IP rate limits are counted against."

  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"

    headers {
      items = ["CloudFront-Viewer-Address"]
    }
  }

  cookies_config {
    # The session lives in an HttpOnly cookie, so an origin that never sees
    # cookies is an origin where nobody is ever signed in.
    cookie_behavior = "all"
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.project} — CloudFront in front of a Lambda function URL, for the custom domain a function URL cannot have on its own."
  aliases         = [var.api_domain]

  # South America is only served by PriceClass_All. Every request reaches the
  # origin anyway — see the cache policy below — so what the edge buys is a
  # nearby TLS termination rather than a cached response, and buying it in the
  # region the visitors are in is the entire point.
  price_class = "PriceClass_All"

  origin {
    origin_id   = "lambda-function-url"
    domain_name = replace(replace(aws_lambda_function_url.api.function_url, "https://", ""), "/", "")

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }

    # This is what makes the function URL safe to leave open.
    #
    # It cannot be closed with origin access control: OAC requires the caller
    # to put a SHA-256 of the request body in x-amz-content-sha256, and a
    # browser doing fetch cannot, so every POST from the site would fail. So
    # the URL stays reachable by anyone, and what separates "anyone" from
    # "this distribution" is a header only this distribution sends.
    #
    # The value is a placeholder here and is written out of band, for the same
    # reason the SSM secrets are: a real value in this file would be a real
    # value in the state file.
    custom_header {
      name  = "x-edge-secret"
      value = "placeholder-set-out-of-band"
    }
  }

  default_cache_behavior {
    target_origin_id       = "lambda-function-url"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    # CachingDisabled, and not as a placeholder to tune later.
    #
    # This API authenticates with an HttpOnly cookie, and CloudFront's default
    # cache policy does not put Cookie in the cache key. The result is literal:
    # the response to one visitor's GET /auth/profile is stored and served to
    # the next visitor. A session leak produced by infrastructure settings,
    # with no line of application code wrong.
    #
    # Caching can be revisited per route, for public reads only, and only with
    # cookies either in the key or stripped from the request. Never globally.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = aws_cloudfront_origin_request_policy.all_viewer_and_address.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    ssl_support_method  = "sni-only"

    # Older viewers can be turned away; this is an API called by a modern
    # frontend, not a public website with a long tail of browsers.
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    # Same split as the function's image: Terraform owns the shape of the
    # distribution, and the secret in the origin header is written afterwards
    # so that it never appears in this file or in state.
    ignore_changes = [origin]
  }
}

output "cloudfront_domain" {
  description = "Point the custom domain's DNS at this. Until then the distribution answers on its own name only."
  value       = aws_cloudfront_distribution.api.domain_name
}
