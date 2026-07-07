########################################################################
# backstage-deploy.tf — deploys the Backstage portal and exposes it.
#
# Ownership is split to solve a chicken-and-egg problem: Backstage's baseUrl
# must equal the URL users hit, but the ALB DNS name does not exist until the
# Ingress is applied. So:
#
#   - Terraform owns the EDGE (namespace + Ingress). Creating the Ingress
#     makes EKS Auto Mode provision an ALB; Terraform waits for it and reads
#     the generated DNS name.
#   - ArgoCD owns the WORKLOAD (Postgres, Deployment, Service, ConfigMap)
#     from gitops/platform-apps/backstage. Terraform passes the discovered
#     ALB host and the ECR image into the ArgoCD Application as Kustomize
#     overrides, so neither value has to live in git.
#
# Result: one `terraform apply` yields a working URL, with the app still
# managed via GitOps.
########################################################################

# Backstage namespace, created up front so the Ingress can live in it before
# ArgoCD syncs the rest of the workload into the same namespace.
resource "kubernetes_namespace_v1" "backstage" {
  metadata {
    name = "backstage"
  }

  depends_on = [module.eks]
}

# HTTPS is enabled when a domain is configured. With an empty domain the
# deploy stays zero-prerequisite: HTTP only, on the ALB's generated DNS name.
locals {
  https_enabled = var.domain != ""

  # Ingress annotations. In HTTPS mode: listen on 443 (and 80 for the
  # redirect), attach the ACM cert, and redirect HTTP->HTTPS. In HTTP mode:
  # just listen on 80.
  backstage_ingress_annotations = local.https_enabled ? {
    "alb.ingress.kubernetes.io/listen-ports"    = jsonencode([{ HTTP = 80 }, { HTTPS = 443 }])
    "alb.ingress.kubernetes.io/certificate-arn" = var.acm_certificate_arn
    "alb.ingress.kubernetes.io/ssl-redirect"    = "443"
    } : {
    "alb.ingress.kubernetes.io/listen-ports" = jsonencode([{ HTTP = 80 }])
  }
}

# The Backstage Ingress. Creating it triggers EKS Auto Mode to provision an
# internet-facing ALB (via the default "alb" IngressClass from ingress.tf).
# wait_for_load_balancer blocks until the ALB is up and its DNS name is
# populated, which we then read below.
resource "kubernetes_ingress_v1" "backstage" {
  metadata {
    name        = "backstage"
    namespace   = kubernetes_namespace_v1.backstage.metadata[0].name
    annotations = local.backstage_ingress_annotations
  }

  spec {
    ingress_class_name = "alb"

    rule {
      # Bind to the configured host in HTTPS mode so the cert's host matches;
      # omit the host in HTTP mode so the ALB serves on any host (its DNS name).
      host = local.https_enabled ? var.domain : null
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = "backstage"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  wait_for_load_balancer = true

  depends_on = [kubectl_manifest.alb_ingressclass]
}

locals {
  # The ALB DNS name EKS Auto Mode generated for the Ingress.
  backstage_alb_host = kubernetes_ingress_v1.backstage.status[0].load_balancer[0].ingress[0].hostname

  # The public URL Backstage is reached at, and baked into its baseUrl/CORS:
  #   - HTTPS mode: the configured domain over https (via the ACM cert + the
  #     Route53 alias below).
  #   - HTTP mode:  the ALB's generated DNS name over http (zero prerequisites).
  backstage_url = local.https_enabled ? "https://${var.domain}" : "http://${local.backstage_alb_host}"

  # Fully-qualified ECR image the CodeBuild project pushes (backstage-build.tf).
  backstage_image = "${aws_ecr_repository.backstage.repository_url}:latest"
}

# Look up the ALB that EKS Auto Mode created for the Backstage Ingress, by the
# tags the controller stamps on it. Used to build the Route53 alias record
# (which needs the ALB's DNS name + canonical hosted zone id). Depends on the
# Ingress so the ALB exists before we query for it.
data "aws_lb" "backstage" {
  count = local.https_enabled ? 1 : 0

  tags = {
    "eks:eks-cluster-name"               = var.cluster_name
    "ingress.eks.amazonaws.com/stack"    = "backstage/backstage"
    "ingress.eks.amazonaws.com/resource" = "LoadBalancer"
  }

  depends_on = [kubernetes_ingress_v1.backstage]
}

# Route53 apex alias -> ALB, so var.domain resolves to the load balancer.
# An alias (not CNAME) is required at a zone apex. Only created in HTTPS mode.
data "aws_route53_zone" "platform" {
  count        = local.https_enabled ? 1 : 0
  name         = var.domain
  private_zone = false
}

resource "aws_route53_record" "backstage_apex" {
  count   = local.https_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.platform[0].zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = data.aws_lb.backstage[0].dns_name
    zone_id                = data.aws_lb.backstage[0].zone_id
    evaluate_target_health = true
  }
}

# Generated secrets, so a public forker needs no external secret store. These
# replace the AWS Secrets Manager + CSI flow the original design used.
resource "random_password" "backstage_postgres" {
  length  = 24
  special = false # avoid characters awkward in URLs / shell / JDBC
}

resource "random_password" "backstage_session" {
  length  = 32
  special = false
}

# Runtime configuration + secrets for Backstage, created by Terraform because
# they depend on values discovered at apply time (the ALB URL) or generated
# here (passwords). The git manifests reference these keys via ${VAR}
# substitution and secretKeyRef, so the values never live in git.
#
#   APP_BASE_URL      -> Backstage baseUrl/backend.baseUrl/CORS (discovered)
#   POSTGRES_PASSWORD -> shared by the Postgres StatefulSet and Backstage
#   SESSION_SECRET    -> Backstage auth session cookie secret
resource "kubernetes_secret_v1" "backstage_runtime" {
  metadata {
    name      = "backstage-runtime"
    namespace = kubernetes_namespace_v1.backstage.metadata[0].name
  }

  data = {
    APP_BASE_URL      = local.backstage_url
    POSTGRES_PASSWORD = random_password.backstage_postgres.result
    SESSION_SECRET    = random_password.backstage_session.result
  }

  type = "Opaque"
}

# The ArgoCD Application that syncs the Backstage workload from git. Terraform
# injects the account-specific ECR image via a Kustomize image override; all
# runtime values come from the backstage-runtime Secret above.
resource "kubectl_manifest" "backstage_argo_app" {
  yaml_body = yamlencode({
    apiVersion = "argoproj.io/v1alpha1"
    kind       = "Application"
    metadata = {
      name      = "backstage"
      namespace = "argocd"
    }
    spec = {
      project = "default"
      source = {
        repoURL        = var.gitops_repo_url
        targetRevision = var.gitops_revision
        path           = "gitops/platform-apps/backstage"
        kustomize = {
          images = ["backstage-image=${local.backstage_image}"]
        }
      }
      destination = {
        name      = "in-cluster"
        namespace = "backstage"
      }
      syncPolicy = {
        automated   = { prune = true, selfHeal = true }
        syncOptions = ["CreateNamespace=true"]
      }
    }
  })

  depends_on = [
    aws_eks_capability.argocd,
    kubernetes_secret_v1.backstage_runtime,
  ]
}
