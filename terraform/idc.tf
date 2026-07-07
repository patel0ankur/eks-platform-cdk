########################################################################
# idc.tf — IAM Identity Center groups for ArgoCD RBAC.
#
# The platform's ArgoCD runs as an EKS Capability, which authenticates and
# authorizes users through IAM Identity Center (IDC). This file:
#   - Looks up the account's existing IDC instance (the instance itself is an
#     account/organization-level resource and must already exist; it is not
#     created here).
#   - Creates three groups used to map IDC users to ArgoCD roles:
#       admin  -> ArgoCD ADMIN
#       editor -> ArgoCD EDITOR
#       viewer -> ArgoCD VIEWER
#   - Creates the ArgoCD admin user and adds it to the admin group.
#
# The instance ARN and group IDs are consumed by argocd.tf.
########################################################################

# Look up the existing IDC instance rather than hardcoding its ARN, so the
# project stays portable across accounts. Fails fast if IAM Identity Center
# has not been enabled in the account.
data "aws_ssoadmin_instances" "this" {}

locals {
  idc_instance_arn  = tolist(data.aws_ssoadmin_instances.this.arns)[0]
  identity_store_id = tolist(data.aws_ssoadmin_instances.this.identity_store_ids)[0]
}

# Three groups mapped to ArgoCD roles by the ArgoCD capability (argocd.tf).
resource "aws_identitystore_group" "admin" {
  identity_store_id = local.identity_store_id
  display_name      = "admin"
  description       = "Platform admins — ArgoCD ADMIN role"
}

resource "aws_identitystore_group" "editor" {
  identity_store_id = local.identity_store_id
  display_name      = "editor"
  description       = "Developers — ArgoCD EDITOR role"
}

resource "aws_identitystore_group" "viewer" {
  identity_store_id = local.identity_store_id
  display_name      = "viewer"
  description       = "Read-only users — ArgoCD VIEWER role"
}

# The ArgoCD admin user. Set its password via the IAM Identity Center console
# (or an email invitation) after apply to enable sign-in to ArgoCD.
resource "aws_identitystore_user" "argocd_admin" {
  identity_store_id = local.identity_store_id

  user_name    = var.argocd_admin.user_name
  display_name = "${var.argocd_admin.given_name} ${var.argocd_admin.family_name}"

  name {
    given_name  = var.argocd_admin.given_name
    family_name = var.argocd_admin.family_name
  }

  emails {
    value   = var.argocd_admin.email
    primary = true
  }
}

# Add the admin user to the admin group so it gets the ArgoCD ADMIN role.
resource "aws_identitystore_group_membership" "admin" {
  identity_store_id = local.identity_store_id
  group_id          = aws_identitystore_group.admin.group_id
  member_id         = aws_identitystore_user.argocd_admin.user_id
}
