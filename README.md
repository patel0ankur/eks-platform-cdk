# EKS Internal Developer Platform (IDP) — Pure CDK

A self-service platform built **entirely with AWS CDK (TypeScript)** — no Terraform.
It provisions, in dependency order: VPC → IAM → CodeBuild → Lambda → EKS → ArgoCD.

The end result is an Internal Developer Platform: a single EKS cluster running
GitOps tooling (ArgoCD) where application teams deploy by committing to Git,
plus the CI (CodeBuild + ECR) that turns their source code into container images.

---

## Prerequisites

You need all of these **before** deploying. Missing any one is the most common
cause of a failed first deploy.

| # | Requirement | Check / Install |
|---|-------------|-----------------|
| 1 | **Node.js 18+** | `node --version` |
| 2 | **AWS account + credentials** configured | `aws sts get-caller-identity` must succeed |
| 3 | **IAM permissions** to create VPC, IAM roles, EKS, CodeBuild, Lambda | Admin or equivalent power-user policy |
| 4 | **AWS CDK bootstrap** in your target account+region (one-time) | see step 2 below |
| 5 | **AWS IAM Identity Center (IDC) enabled** in the account | `aws sso-admin list-instances` must return an instance |

> **About credentials:** the deployment uses *your* active AWS credentials
> (from `aws configure`, SSO, or environment variables). Your account ID is
> never hardcoded — it is resolved at deploy time from those credentials.

> **About Identity Center (IDC):** the platform deploys ArgoCD as an
> [EKS Capability](https://docs.aws.amazon.com/eks/latest/userguide/capabilities.html),
> which requires an IAM Identity Center instance for its sign-in and RBAC.
> **You must enable Identity Center before deploying** — this project does not
> create the IDC instance (it is an account/organization-level resource); it
> only adds the ArgoCD access groups to your existing instance. Enable it once
> in the [IAM Identity Center console](https://console.aws.amazon.com/singlesignon/)
> (or via AWS Organizations), then verify:
>
> ```bash
> aws sso-admin list-instances --query 'Instances[0].InstanceArn' --output text
> # must print an ARN like arn:aws:sso:::instance/ssoins-xxxxxxxxxxxx (not "None")
> ```

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. One-time CDK bootstrap for YOUR account + region.
#    (Skip only if this account+region was bootstrapped before.)
npx cdk bootstrap

# 3. Deploy everything, in order. CDK resolves cross-stack dependencies
#    and deploys in the correct sequence automatically.
npx cdk deploy --all

# ...or deploy one stack at a time to follow along:
npx cdk deploy idp-network
npx cdk deploy idp-iam
npx cdk deploy idp-codebuild
# (idp-lambda, idp-eks, idp-argocd — added in later steps)
```

---

## Choosing a region

Defaults to **us-east-1**. To deploy elsewhere, set `CDK_DEPLOY_REGION`
(works for any commercial region — EKS is available everywhere):

```bash
CDK_DEPLOY_REGION=eu-west-1 npx cdk bootstrap
CDK_DEPLOY_REGION=eu-west-1 npx cdk deploy --all
```

The region is **not** auto-read from your shell's `AWS_REGION` — this is
deliberate, so your stacks stay in one predictable region rather than moving if
your shell environment changes.

---

## What gets created

| Stack | Resources | Approx. idle cost |
|-------|-----------|-------------------|
| `idp-network` | VPC, public/private subnets (2 AZ), 1 NAT gateway, EKS subnet tags | ~$32/mo (NAT gateway + EIP) |
| `idp-iam` | EKS cluster role, node role, CodeBuild role (least-privilege) | free |
| `idp-codebuild` | ECR repository, CodeBuild image-builder project | ~$0 idle (pay per build) |
| `idp-lambda` | *(coming)* automation helper | minimal |
| `idp-eks` | *(coming)* EKS cluster + managed node group | EKS control plane ~$73/mo + EC2 nodes |
| `idp-argocd` | *(coming)* ArgoCD via Helm | runs on the cluster |

> Costs are us-east-1 estimates and will vary by region/usage.

---

## Accessing ArgoCD

ArgoCD runs as a managed EKS Capability and uses **IAM Identity Center (IDC)
single sign-on** — there is no local `admin`/password login. Access is granted
by IDC group membership, which maps to an ArgoCD role:

| IDC group | ArgoCD role |
|-----------|-------------|
| `admin`   | ADMIN  (full access) |
| `editor`  | EDITOR (deploy/sync apps) |
| `viewer`  | VIEWER (read-only) |

The deploy creates an `argocd-admin` IDC user and adds it to the `admin` group.
To sign in:

1. **Set a password for the user.** IDC users are created without one. In the
   [IAM Identity Center console](https://console.aws.amazon.com/singlesignon/)
   → **Users** → `argocd-admin` → **Reset password** → *Generate a one-time
   password*. (Optionally edit the user's email to a real address first.)

   _Alternatively_, grant an existing IDC user (one that already has a password)
   ArgoCD access by adding it to a group:
   ```bash
   aws identitystore create-group-membership \
     --identity-store-id <IDENTITY_STORE_ID> \
     --group-id <ADMIN_GROUP_ID> \
     --member-id UserId=<YOUR_USER_ID> \
     --region <REGION>
   ```
   (Group IDs are stack outputs of `idp-idc`; find user IDs with
   `aws identitystore list-users --identity-store-id <IDENTITY_STORE_ID>`.)

2. **Open the ArgoCD URL.** Get it from the capability:
   ```bash
   aws eks describe-capability --cluster-name idp-cluster --capability-name argocd \
     --region <REGION> --query 'capability.configuration.argoCd.serverUrl' --output text
   ```

3. **Sign in via IDC.** The URL redirects to your AWS access portal; after
   authenticating, ArgoCD grants the role mapped to your group. If access is
   denied on the first try, sign in to your IDC portal first, then reopen the
   ArgoCD URL (SSO propagation can take ~1 minute).

---

## Cleanup

Destroy everything to stop charges (reverse dependency order is handled by CDK):

```bash
npx cdk destroy --all
```

The ECR repo is set to delete its images automatically. IAM roles, VPC, and
CodeBuild are removed cleanly.

---

## Project layout

```
bin/app.ts             # App entry point — wires up all stacks + region/account
lib/config.ts          # Shared constants (prefix, names, versions) used across stacks
lib/network-stack.ts   # VPC + networking
lib/iam-stack.ts       # CodeBuild IAM role
lib/codebuild-stack.ts # ECR repository + CodeBuild CI project
lib/lambda-stack.ts    # Lambda custom resource that triggers the build on deploy
lib/eks-stack.ts       # EKS cluster + managed node group (+ cluster/node roles)
lib/idc-stack.ts       # Identity Center groups + ArgoCD admin user
lib/argocd-stack.ts    # ArgoCD as an EKS Capability, wired to IDC RBAC
cdk.json               # Tells CDK how to run the app
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `... requires bootstrap` / `SSM parameter /cdk-bootstrap/... not found` | Account+region not bootstrapped | run `npx cdk bootstrap` |
| `Unable to resolve AWS account to use` | No/invalid credentials | configure AWS credentials, verify with `aws sts get-caller-identity` |
| `AccessDenied` during deploy | Insufficient IAM permissions | use a role/user with admin or the needed service permissions |
| `cdk: command not found` | Dependencies not installed | run `npm install`, use `npx cdk ...` |
| ArgoCD capability fails / no IDC instance found | Identity Center not enabled | enable IAM Identity Center (prerequisite #5), verify with `aws sso-admin list-instances` |

> **Note:** `cdk.context.json` is intentionally git-ignored. CDK regenerates it
> per-account at synth time; committing it would leak account-specific data.
```
