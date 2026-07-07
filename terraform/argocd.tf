########################################################################
# argocd.tf — ArgoCD as a managed EKS Capability.
#
# Creates an EKS Capability of type ARGOCD on the cluster. AWS runs and
# manages ArgoCD itself; it does not consume the cluster's worker nodes.
# Sign-in and RBAC are handled through IAM Identity Center: the three IDC
# groups from idc.tf are mapped to ArgoCD's ADMIN, EDITOR, and VIEWER roles.
#
# Creates:
#   - An IAM role the capability assumes to access AWS services
#   - The ARGOCD capability wired to the IDC instance and group mappings
#   - A cluster-admin access-policy association for the capability role, and
#     a cluster registration Secret so the local cluster is a valid
#     Application destination (destination name "in-cluster")
########################################################################

# Role assumed by the EKS capabilities service to run ArgoCD. The trust
# policy must allow both sts:AssumeRole and sts:TagSession for the
# capabilities.eks.amazonaws.com principal.
data "aws_iam_policy_document" "argocd_capability_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["capabilities.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "argocd_capability" {
  name               = "${var.prefix}-argocd-capability-role"
  description        = "Role assumed by the ArgoCD EKS capability"
  assume_role_policy = data.aws_iam_policy_document.argocd_capability_assume.json
}

resource "aws_iam_role_policy_attachment" "argocd_secrets_read" {
  role       = aws_iam_role.argocd_capability.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AWSSecretsManagerClientReadOnlyAccess"
}

# Give the role's trust policy time to propagate through IAM before EKS
# validates it. Without this, CreateCapability can race ahead of IAM
# consistency and fail with "The trust policy for the provided role is
# invalid" on a clean-slate deploy.
resource "time_sleep" "argocd_role_propagation" {
  depends_on      = [aws_iam_role.argocd_capability]
  create_duration = "20s"
}

# The ARGOCD capability. delete_propagation_policy = RETAIN keeps the
# resources the capability manages if the capability itself is removed.
resource "aws_eks_capability" "argocd" {
  cluster_name              = module.eks.cluster_name
  capability_name           = "argocd"
  type                      = "ARGOCD"
  role_arn                  = aws_iam_role.argocd_capability.arn
  delete_propagation_policy = "RETAIN"

  # Wait for the trust policy to propagate (see time_sleep above).
  depends_on = [time_sleep.argocd_role_propagation]

  configuration {
    argo_cd {
      namespace = "argocd"

      aws_idc {
        idc_instance_arn = local.idc_instance_arn
      }

      rbac_role_mapping {
        role = "ADMIN"
        identity {
          id   = aws_identitystore_group.admin.group_id
          type = "SSO_GROUP"
        }
      }
      rbac_role_mapping {
        role = "EDITOR"
        identity {
          id   = aws_identitystore_group.editor.group_id
          type = "SSO_GROUP"
        }
      }
      rbac_role_mapping {
        role = "VIEWER"
        identity {
          id   = aws_identitystore_group.viewer.group_id
          type = "SSO_GROUP"
        }
      }
    }
  }
}

# Grant the capability role Kubernetes RBAC on the cluster. The capability
# auto-creates an EKS access entry for this role but with NO permissions, so
# ArgoCD cannot deploy until a policy is associated. We associate the policy
# against the existing entry (a standalone access entry would conflict with
# the one the capability created). Cluster-admin is used for simplicity;
# scope down for production.
resource "aws_eks_access_policy_association" "argocd_cluster_admin" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.argocd_capability.arn
  policy_arn    = "arn:${local.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_capability.argocd]
}

# Register the local cluster as an ArgoCD deployment destination named
# "in-cluster". The capability does NOT auto-register it. The Secret must use
# the EKS cluster ARN (the managed capability identifies clusters by ARN; the
# Kubernetes API URL is not supported).
resource "kubectl_manifest" "argocd_in_cluster_secret" {
  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Secret"
    metadata = {
      name      = "in-cluster"
      namespace = "argocd"
      labels = {
        "argocd.argoproj.io/secret-type" = "cluster"
      }
    }
    stringData = {
      name    = "in-cluster"
      server  = module.eks.cluster_arn
      project = "default"
    }
  })

  depends_on = [aws_eks_capability.argocd]
}
