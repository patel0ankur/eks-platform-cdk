########################################################################
# outputs.tf — values surfaced after `terraform apply`.
#
# Collected here (rather than beside each resource) so every output the
# platform exposes is visible in one place. Grouped by the component that
# produces them.
########################################################################

# --- network (network.tf) ---

output "vpc_id" {
  description = "The VPC the EKS cluster runs in"
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "Private subnets where worker nodes run"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnets for internet-facing load balancers"
  value       = aws_subnet.public[*].id
}

# --- IAM (iam.tf) ---

output "codebuild_role_arn" {
  description = "ARN of the CodeBuild CI role"
  value       = aws_iam_role.codebuild.arn
}

# --- CodeBuild (codebuild.tf) ---

output "ecr_repository_uri" {
  description = "ECR repository URI where images are pushed"
  value       = aws_ecr_repository.app.repository_url
}

output "codebuild_project_name" {
  description = "CodeBuild project name (use with: aws codebuild start-build)"
  value       = aws_codebuild_project.image_builder.name
}

# --- EKS (eks.tf) ---

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value       = module.eks.cluster_arn
}

output "configure_kubectl" {
  description = "Command to configure kubectl for this cluster"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

# --- IAM Identity Center (idc.tf) ---

output "idc_instance_arn" {
  description = "IAM Identity Center instance ARN"
  value       = local.idc_instance_arn
}

output "admin_group_id" {
  description = "IDC group mapped to the ArgoCD ADMIN role"
  value       = aws_identitystore_group.admin.group_id
}

output "editor_group_id" {
  description = "IDC group mapped to the ArgoCD EDITOR role"
  value       = aws_identitystore_group.editor.group_id
}

output "viewer_group_id" {
  description = "IDC group mapped to the ArgoCD VIEWER role"
  value       = aws_identitystore_group.viewer.group_id
}

output "argocd_admin_user_name" {
  description = "Identity Center user with ArgoCD ADMIN role (set its password to sign in)"
  value       = var.argocd_admin.user_name
}

# --- ArgoCD capability (argocd.tf) ---

output "argocd_capability_name" {
  description = "Name of the ArgoCD EKS capability"
  value       = aws_eks_capability.argocd.capability_name
}

# --- Backstage build (backstage-build.tf) ---

output "backstage_ecr_repository_uri" {
  description = "ECR repository URI for the Backstage image"
  value       = aws_ecr_repository.backstage.repository_url
}

# --- Backstage deploy (backstage-deploy.tf) ---

output "backstage_url" {
  description = "Public URL for the Backstage portal (open in a browser)"
  value       = local.backstage_url
}
