########################################################################
# main.tf — providers, backend, and shared data sources.
#
# Each component of the platform lives in one .tf file in this directory;
# Terraform merges every .tf file in the directory into a single root
# module (so the split is organizational only — everything shares one
# state).
#
# Deployment environment:
#   - account: always the deploying user's active credentials
#              (data.aws_caller_identity.current.account_id).
#   - region:  var.region (default us-east-1). EKS is available in all
#              commercial regions, so the default works anywhere. Override
#              with TF_VAR_region=eu-west-1 to deploy elsewhere.
########################################################################

terraform {
  # Developed and validated against Terraform 1.15.x. A floor of 1.13 keeps
  # teammates on a recent 1.x working without forcing an exact match.
  required_version = ">= 1.13"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
    # Applies raw Kubernetes manifests / CRDs (ArgoCD Application/
    # ApplicationSet, the in-cluster Secret, the gp3 StorageClass). The
    # kubectl provider applies server-side without needing each CRD's schema
    # at plan time, which the built-in kubernetes_manifest resource would
    # require.
    kubectl = {
      source  = "alekc/kubectl"
      version = ">= 2.0"
    }
    # Used to create the Backstage Ingress and wait for its ALB to be
    # provisioned, then read the ALB's DNS name (see backstage-deploy.tf).
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.30"
    }
    # Used for a short propagation delay between IAM role creation and the
    # EKS capability that validates its trust policy (see argocd.tf).
    time = {
      source  = "hashicorp/time"
      version = ">= 0.9"
    }
    # Generates the Backstage Postgres password + session secret so a forker
    # needs no external secret store (see backstage-deploy.tf).
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }

  # Local state for now. To move to a remote backend later, add an
  # `backend "s3" { ... }` block here and run `terraform init -migrate-state`.
}

# AWS provider. `auto-delete = never` is applied to every taggable resource
# via default_tags. It marks resources so automated cleanup/janitor
# processes skip them.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      "auto-delete" = "never"
    }
  }
}

# Current identity + partition/region context.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  partition  = data.aws_partition.current.partition

  # IAM principal granted cluster-admin on the EKS cluster. Defaults to the
  # identity running the apply. Override with var.admin_principal_arn.
  admin_principal_arn = coalesce(var.admin_principal_arn, data.aws_caller_identity.current.arn)
}

# Kubernetes access for the kubectl provider. Populated from the EKS module
# outputs once the cluster exists (see eks.tf); token auth mirrors
# `aws eks get-token`, so no kubeconfig file is needed on disk.
provider "kubectl" {
  host                   = try(module.eks.cluster_endpoint, "")
  cluster_ca_certificate = try(base64decode(module.eks.cluster_certificate_authority_data), "")
  load_config_file       = false

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.region]
  }
}

# Same cluster auth as the kubectl provider above; used for the Backstage
# Ingress, which waits for and exposes the ALB DNS name.
provider "kubernetes" {
  host                   = try(module.eks.cluster_endpoint, "")
  cluster_ca_certificate = try(base64decode(module.eks.cluster_certificate_authority_data), "")

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.region]
  }
}
