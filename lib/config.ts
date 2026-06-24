/**
 * Shared configuration constants used across all stacks.
 *
 * Keeping these in one place means the VPC, EKS cluster, IAM roles, etc.
 * all agree on naming and region without magic strings scattered around.
 */
export const config = {
  /**
   * Prefix applied to resource names so everything is easy to find/clean up.
   * "idp" = Internal Developer Platform — the self-service platform this builds.
   */
  prefix: "idp",

  /** EKS cluster name — referenced by the EKS stack and ArgoCD stack later. */
  clusterName: "idp-cluster",

  /** ECR repository name where CodeBuild pushes built application images. */
  ecrRepoName: "idp-app",

  /** Kubernetes version for the EKS cluster. */
  kubernetesVersion: "1.35",

  /**
   * GitOps source repository that ArgoCD syncs from. ArgoCD Application CRs
   * point at folders under `gitops/` in this repo. The repo must be reachable
   * by ArgoCD (public GitHub, or private with registered credentials).
   *
   * Override the URL with the CDK_GITOPS_REPO_URL env var, e.g.:
   *   export CDK_GITOPS_REPO_URL=https://github.com/<you>/eks-platform-cdk
   */
  gitops: {
    repoUrl:
      process.env.CDK_GITOPS_REPO_URL ??
      "https://github.com/REPLACE_ME/eks-platform-cdk",
    /** Git branch/tag/commit ArgoCD tracks. */
    revision: "main",
  },

  /**
   * ArgoCD admin user created in Identity Center and added to the admin group.
   * After deploy, set this user's password via the IAM Identity Center console
   * (or email invitation) to enable sign-in to ArgoCD.
   */
  argocdAdmin: {
    userName: "argocd-admin",
    email: "argocd-admin@example.com",
    givenName: "ArgoCD",
    familyName: "Admin",
  },

  /** Worker node group sizing. */
  nodeGroup: {
    /** EC2 instance type for worker nodes. */
    instanceType: "t3.large",
    /** Desired node count at launch. */
    desiredSize: 2,
    /** Minimum nodes the group scales down to. */
    minSize: 1,
    /** Maximum nodes the group scales up to. */
    maxSize: 4,
  },

  /** Max Availability Zones for the VPC. 2 is the sweet spot for cost vs. HA. */
  maxAzs: 2,

  /**
   * Number of NAT gateways. 1 = cheaper (single AZ egress), 2 = HA.
   * Start with 1 for a learning/dev environment.
   */
  natGateways: 1,
};
