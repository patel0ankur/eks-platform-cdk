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

# The Backstage Ingress. Creating it triggers EKS Auto Mode to provision an
# internet-facing ALB (via the default "alb" IngressClass from ingress.tf).
# wait_for_load_balancer blocks until the ALB is up and its DNS name is
# populated, which we then read below.
resource "kubernetes_ingress_v1" "backstage" {
  metadata {
    name      = "backstage"
    namespace = kubernetes_namespace_v1.backstage.metadata[0].name
  }

  spec {
    ingress_class_name = "alb"

    rule {
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
  # The ALB DNS name EKS Auto Mode generated for the Ingress. HTTP only — no
  # domain or certificate required, so this works for any user out of the box.
  backstage_host = kubernetes_ingress_v1.backstage.status[0].load_balancer[0].ingress[0].hostname
  backstage_url  = "http://${local.backstage_host}"

  # Fully-qualified ECR image the CodeBuild project pushes (backstage-build.tf).
  backstage_image = "${aws_ecr_repository.backstage.repository_url}:latest"
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
