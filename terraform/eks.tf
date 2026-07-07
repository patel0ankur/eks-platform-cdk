########################################################################
# eks.tf — the EKS cluster, running in EKS Auto Mode.
#
# Built on the community terraform-aws-modules/eks module (v21), following
# the aws-samples "platform engineering on EKS" reference. Auto Mode hands
# compute, storage, and load-balancing management to EKS itself, so this
# file is far smaller than a self-managed cluster would be:
#
#   - No managed node group / launch template — Auto Mode provisions and
#     scales nodes from the "general-purpose" and "system" node pools.
#   - No vpc-cni / coredns / kube-proxy addons — Auto Mode bundles the core
#     networking components.
#   - No EBS CSI driver addon or gp3 StorageClass — Auto Mode ships managed
#     storage and a default StorageClass.
#
# The cluster runs in the private subnets of the VPC defined in network.tf.
########################################################################

locals {
  # The deployer always gets cluster-admin via
  # enable_cluster_creator_admin_permissions below. If a *different* admin
  # principal is configured, grant that one an access entry too. Comparing
  # against the caller ARN avoids a duplicate entry for the deployer.
  extra_admin_access_entries = local.admin_principal_arn == data.aws_caller_identity.current.arn ? {} : {
    admin = {
      principal_arn = local.admin_principal_arn
      policy_associations = {
        cluster_admin = {
          policy_arn   = "arn:${local.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  # Reachable publicly and privately. Public access lets you run kubectl from
  # your machine; nodes use the private path inside the VPC.
  endpoint_public_access = true

  # Access entries (the modern access model). The deploying identity is
  # granted cluster-admin automatically so it can run kubectl out of the box.
  authentication_mode                      = "API"
  enable_cluster_creator_admin_permissions = true
  access_entries                           = local.extra_admin_access_entries

  # No envelope encryption key — avoids a standalone KMS key. Set
  # create_kms_key = true (and drop the null below) to enable it.
  create_kms_key    = false
  encryption_config = null

  # Run in the VPC from network.tf, placing the cluster in the private subnets.
  vpc_id     = aws_vpc.this.id
  subnet_ids = aws_subnet.private[*].id

  # EKS Auto Mode: EKS manages compute (nodes), storage, and load balancing.
  compute_config = {
    enabled    = true
    node_pools = ["general-purpose", "system"]
  }

  tags = {
    Environment = "platform"
  }
}

# Default StorageClass backed by EKS Auto Mode's EBS CSI driver
# (ebs.csi.eks.amazonaws.com). Auto Mode enables managed storage but does NOT
# create a default-annotated StorageClass, so a PersistentVolumeClaim without
# an explicit storageClassName (e.g. the Backstage/Postgres data volume) would
# stay Pending. Marking this class default makes those PVCs bind automatically.
# gp3 is cheaper/faster than the cluster's legacy gp2 in-tree class; volumes
# are encrypted and bound once a consuming pod is scheduled.
resource "kubectl_manifest" "gp3_default_storage_class" {
  yaml_body = yamlencode({
    apiVersion = "storage.k8s.io/v1"
    kind       = "StorageClass"
    metadata = {
      name = "gp3"
      annotations = {
        "storageclass.kubernetes.io/is-default-class" = "true"
      }
    }
    provisioner          = "ebs.csi.eks.amazonaws.com"
    volumeBindingMode    = "WaitForFirstConsumer"
    allowVolumeExpansion = true
    parameters = {
      type      = "gp3"
      encrypted = "true"
    }
  })

  depends_on = [module.eks]
}
