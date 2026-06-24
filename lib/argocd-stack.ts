import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { config } from "./config";

export interface ArgoCdStackProps extends cdk.StackProps {
  /** Name of the EKS cluster to attach the capability to (from EksStack). */
  readonly clusterName: string;
  /** IAM Identity Center instance ARN (from IdcStack). */
  readonly idcInstanceArn: string;
  /** IDC group IDs mapped to ArgoCD roles (from IdcStack). */
  readonly adminGroupId: string;
  readonly editorGroupId: string;
  readonly viewerGroupId: string;
}

/**
 * ArgoCdStack — ArgoCD as a managed EKS Capability.
 *
 * Creates an EKS Capability of type ARGOCD on the cluster. AWS runs and
 * manages ArgoCD itself; it does not consume the cluster's worker nodes.
 * Sign-in and RBAC are handled through IAM Identity Center: the three IDC
 * groups are mapped to ArgoCD's ADMIN, EDITOR, and VIEWER roles.
 *
 * Creates:
 *   - An IAM role the capability assumes to access AWS services
 *   - The ARGOCD capability wired to the IDC instance and group mappings
 */
export class ArgoCdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ArgoCdStackProps) {
    super(scope, id, props);

    // Role assumed by the EKS capabilities service to run ArgoCD. The trust
    // policy must allow both sts:AssumeRole and sts:TagSession for the
    // capabilities.eks.amazonaws.com principal, so the principal is built
    // explicitly to include both actions.
    const capabilityRole = new iam.Role(this, "ArgoCdCapabilityRole", {
      roleName: `${config.prefix}-argocd-capability-role`,
      assumedBy: new iam.ServicePrincipal("capabilities.eks.amazonaws.com"),
      description: "Role assumed by the ArgoCD EKS capability",
    });
    // Add sts:TagSession to the trust policy (required by EKS capabilities).
    (capabilityRole.assumeRolePolicy as iam.PolicyDocument).addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal("capabilities.eks.amazonaws.com"),
        ],
        actions: ["sts:TagSession"],
      }),
    );
    capabilityRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AWSSecretsManagerClientReadOnlyAccess",
      ),
    );

    // The ARGOCD capability. RETAIN delete propagation keeps the resources the
    // capability manages if the capability is removed.
    new eks.CfnCapability(this, "ArgoCdCapability", {
      clusterName: props.clusterName,
      capabilityName: "argocd",
      type: "ARGOCD",
      roleArn: capabilityRole.roleArn,
      deletePropagationPolicy: "RETAIN",
      configuration: {
        argoCd: {
          awsIdc: {
            idcInstanceArn: props.idcInstanceArn,
          },
          namespace: "argocd",
          rbacRoleMappings: [
            {
              role: "ADMIN",
              identities: [{ id: props.adminGroupId, type: "SSO_GROUP" }],
            },
            {
              role: "EDITOR",
              identities: [{ id: props.editorGroupId, type: "SSO_GROUP" }],
            },
            {
              role: "VIEWER",
              identities: [{ id: props.viewerGroupId, type: "SSO_GROUP" }],
            },
          ],
        },
      },
    });

    new cdk.CfnOutput(this, "ArgoCdCapabilityName", {
      value: "argocd",
      description: "Name of the ArgoCD EKS capability",
    });
  }
}
