#!/usr/bin/env node
import "source-map-support/register";
import { execFileSync } from "child_process";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { IamStack } from "../lib/iam-stack";
import { CodeBuildStack } from "../lib/codebuild-stack";
import { LambdaStack } from "../lib/lambda-stack";
import { EksStack } from "../lib/eks-stack";
import { IdcStack } from "../lib/idc-stack";
import { ArgoCdStack } from "../lib/argocd-stack";
import { PlatformBootstrapStack } from "../lib/platform-bootstrap-stack";
import { SecretsStack } from "../lib/secrets-stack";
import { BackstageBuildStack } from "../lib/backstage-build-stack";
import { IngressStack } from "../lib/ingress-stack";
import { config } from "../lib/config";

/**
 * Resolve the ARN of the currently active AWS identity via STS. Used as the
 * default cluster-admin principal so the deployer can access the cluster.
 * Falls back to throwing a clear message if credentials are unavailable.
 */
function resolveCallerArn(): string {
  try {
    const arn = execFileSync(
      "aws",
      ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
      { encoding: "utf-8" },
    ).trim();
    if (!arn) throw new Error("empty ARN");
    return arn;
  } catch {
    throw new Error(
      "Could not resolve the caller ARN for EKS admin access. Ensure AWS " +
        "credentials are configured, or set CDK_DEPLOY_ADMIN_ARN explicitly:\n" +
        "  export CDK_DEPLOY_ADMIN_ARN=$(aws sts get-caller-identity --query Arn --output text)",
    );
  }
}

const app = new cdk.App();

// Apply to every resource in every stack. Propagated automatically by CDK to
// all taggable resources. Marks resources so automated cleanup/janitor
// processes skip them.
cdk.Tags.of(app).add("auto-delete", "never");

// Resolve the deployment environment in a portable, multi-user way:
//   - account: always taken from the deploying user's active credentials.
//   - region:  CDK_DEPLOY_REGION env var if set (explicit opt-in), otherwise
//              a sensible default of us-east-1. EKS is available in all
//              commercial regions, so the default works anywhere.
//
// We intentionally do NOT auto-read CDK_DEFAULT_REGION here: a fixed default
// keeps a user's stacks in one predictable region instead of silently moving
// if their shell AWS_REGION changes. Override explicitly to deploy elsewhere:
//   CDK_DEPLOY_REGION=eu-west-1 npx cdk deploy --all
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION ?? "us-east-1",
};

// VPC and networking.
const networkStack = new NetworkStack(app, `${config.prefix}-network`, { env });

// IAM roles for the EKS control plane, worker nodes, and CodeBuild.
const iamStack = new IamStack(app, `${config.prefix}-iam`, { env });

// CodeBuild CI. Takes the CodeBuild role ARN from IamStack; CDK uses this
// reference to order the deployment (IAM before CodeBuild).
const codeBuildStack = new CodeBuildStack(app, `${config.prefix}-codebuild`, {
  env,
  codeBuildRoleArn: iamStack.codeBuildRole.roleArn,
});

// Lambda automation. A custom resource that starts the CodeBuild build on
// deploy. Takes the project name and ARN from CodeBuildStack; CDK orders the
// deployment (CodeBuild before Lambda).
new LambdaStack(app, `${config.prefix}-lambda`, {
  env,
  codeBuildProjectName: codeBuildStack.project.projectName,
  codeBuildProjectArn: codeBuildStack.project.projectArn,
});

// IAM principal granted kubectl/cluster-admin on the EKS cluster.
// Defaults to the identity running the deploy (resolved via STS), so the
// deployer can access the cluster out of the box. Override with
// CDK_DEPLOY_ADMIN_ARN to grant a different user/role instead.
const adminPrincipalArn =
  process.env.CDK_DEPLOY_ADMIN_ARN ?? resolveCallerArn();

// EKS cluster + managed node group. Takes the VPC from NetworkStack; the
// cluster and node IAM roles are defined inside the stack. CDK orders the
// deployment so the network exists first.
const eksStack = new EksStack(app, `${config.prefix}-eks`, {
  env,
  vpc: networkStack.vpc,
  adminPrincipalArn,
});

// IAM Identity Center groups for ArgoCD RBAC. Looks up the existing IDC
// instance and creates admin/editor/viewer groups.
const idcStack = new IdcStack(app, `${config.prefix}-idc`, { env });

// ArgoCD as a managed EKS capability, wired to the IDC instance and groups.
// Depends on the cluster existing and the IDC groups being created.
const argoCdStack = new ArgoCdStack(app, `${config.prefix}-argocd`, {
  env,
  cluster: eksStack.cluster,
  idcInstanceArn: idcStack.instanceArn,
  adminGroupId: idcStack.adminGroupId,
  editorGroupId: idcStack.editorGroupId,
  viewerGroupId: idcStack.viewerGroupId,
});
argoCdStack.addDependency(eksStack);

// Platform GitOps bootstrap: one ArgoCD ApplicationSet that scans
// gitops/platform/* and creates an Application per component (Keycloak,
// Backstage, ...). Depends on the ArgoCD capability (it provides the
// ApplicationSet CRD). After this, adding a platform component is just adding
// a folder under gitops/platform/ — no CDK change.
const platformBootstrap = new PlatformBootstrapStack(
  app,
  `${config.prefix}-platform-bootstrap`,
  { env, cluster: eksStack.cluster },
);
platformBootstrap.addDependency(argoCdStack);

// Secrets Manager passwords + the AWS Secrets Store CSI provider add-on and
// Pod Identity wiring, so platform workloads (Keycloak, Postgres) read secrets
// from Secrets Manager instead of hardcoded values.
const secretsStack = new SecretsStack(app, `${config.prefix}-secrets`, {
  env,
  clusterName: config.clusterName,
});
secretsStack.addDependency(eksStack);

// Backstage image build: CodeBuild builds backstage/ from this repo into ECR,
// auto-triggered on deploy. Reuses the CodeBuild role from IamStack.
new BackstageBuildStack(app, `${config.prefix}-backstage-build`, {
  env,
  codeBuildRoleArn: iamStack.codeBuildRole.roleArn,
});

// Ingress: IAM (Pod Identity) for the AWS Load Balancer Controller. The
// controller itself is installed via GitOps (gitops/platform/
// aws-load-balancer-controller). Provisions ALBs from Ingress objects.
const ingressStack = new IngressStack(app, `${config.prefix}-ingress`, {
  env,
  cluster: eksStack.cluster,
});
ingressStack.addDependency(eksStack);

app.synth();
