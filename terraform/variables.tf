########################################################################
# variables.tf — shared configuration.
#
# Keeping these in one place means the VPC, EKS cluster, IAM roles, etc.
# all agree on naming and region without magic strings scattered around.
#
# Any value can be overridden per-deploy with an environment variable of the
# form TF_VAR_<name>, e.g. `export TF_VAR_domain=platform.example.com`.
########################################################################

# Deploy region. Override with TF_VAR_region. EKS is available in all
# commercial regions.
variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

# Prefix applied to resource names so everything is easy to find/clean up.
# "idp" = Internal Developer Platform — the self-service platform this builds.
variable "prefix" {
  description = "Name prefix for all resources"
  type        = string
  default     = "idp"
}

# EKS cluster name — referenced by the EKS and ArgoCD configuration.
variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "idp-cluster"
}

# ECR repository name where CodeBuild pushes built application images.
variable "ecr_repo_name" {
  description = "ECR repository for built application images"
  type        = string
  default     = "idp-app"
}

# ECR repository for the Backstage developer-portal image.
variable "backstage_ecr_repo_name" {
  description = "ECR repository for the Backstage image"
  type        = string
  default     = "idp-backstage"
}

# Kubernetes version for the EKS cluster.
variable "kubernetes_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.35"
}

# Platform domain — the apex hostname Backstage is served at.
#
# OPTIONAL. Leave empty ("") for a zero-prerequisite deploy: Backstage is
# exposed over HTTP on the ALB's auto-generated DNS name, no domain or
# certificate needed.
#
# To serve HTTPS on your own domain, set BOTH:
#   - domain               = the hostname (must be an apex/host the ACM cert
#                            below covers), e.g. patelax.people.aws.dev
#   - acm_certificate_arn  = an ISSUED ACM cert (us-east-1) covering that host
# and have a Route53 public hosted zone for the domain. Terraform then creates
# the apex alias record and switches the Ingress to HTTPS.
variable "domain" {
  description = "Apex domain for HTTPS (empty = HTTP on the ALB DNS name)"
  type        = string
  default     = ""
}

# ACM certificate ARN (us-east-1) covering var.domain. Required only when
# var.domain is set. Ignored when domain is empty.
variable "acm_certificate_arn" {
  description = "ACM certificate ARN for var.domain (required if domain is set)"
  type        = string
  default     = ""
}

# GitOps source repository that ArgoCD syncs from. ArgoCD Application CRs
# point at folders under `gitops/` in this repo. The repo must be reachable
# by ArgoCD (public GitHub, or private with registered credentials).
variable "gitops_repo_url" {
  description = "GitOps repository ArgoCD syncs from"
  type        = string
  default     = "https://github.com/patel0ankur/eks-platform-cdk"
}

# Git branch/tag/commit ArgoCD tracks.
variable "gitops_revision" {
  description = "Git revision ArgoCD tracks"
  type        = string
  default     = "main"
}

# IAM principal (user or role) ARN granted cluster-admin via an EKS access
# entry. Defaults to the identity running the apply (see locals in main.tf).
variable "admin_principal_arn" {
  description = "IAM principal ARN granted EKS cluster-admin (defaults to caller)"
  type        = string
  default     = null
}

# Opaque token that changes per apply to re-trigger the Backstage image build
# (see backstage-build.tf). Pass a fresh value to force a rebuild, e.g.
#   terraform apply -var="backstage_build_token=$(date +%s)"
# Leave at the default to avoid rebuilding on every apply.
variable "backstage_build_token" {
  description = "Change to force a Backstage image rebuild on apply"
  type        = string
  default     = "initial"
}

# ArgoCD admin user created in Identity Center and added to the admin group.
# After deploy, set this user's password via the IAM Identity Center console
# (or email invitation) to enable sign-in to ArgoCD.
variable "argocd_admin" {
  description = "ArgoCD admin user created in Identity Center"
  type = object({
    user_name   = string
    email       = string
    given_name  = string
    family_name = string
  })
  default = {
    user_name   = "argocd-admin"
    email       = "argocd-admin@example.com"
    given_name  = "ArgoCD"
    family_name = "Admin"
  }
}

# Worker node group sizing.
variable "node_group" {
  description = "EKS managed node group sizing"
  type = object({
    instance_type = string # EC2 instance type for worker nodes
    desired_size  = number # Desired node count at launch
    min_size      = number # Minimum nodes the group scales down to
    max_size      = number # Maximum nodes the group scales up to
  })
  default = {
    instance_type = "t3.large"
    desired_size  = 3
    min_size      = 2
    max_size      = 4
  }
}

# Max Availability Zones for the VPC. 2 is the sweet spot for cost vs. HA.
variable "max_azs" {
  description = "Maximum number of Availability Zones for the VPC"
  type        = number
  default     = 2
}

# Number of NAT gateways. 1 = cheaper (single AZ egress), 2 = HA.
# Start with 1 for a learning/dev environment.
variable "nat_gateways" {
  description = "Number of NAT gateways (1 = cheaper, 2 = HA)"
  type        = number
  default     = 1
}
