import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { config } from "./config";

export interface ArgoCdStackProps extends cdk.StackProps {
  /** The EKS cluster to attach the capability to (from EksStack). */
  readonly cluster: eks.Cluster;
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
 *   - Kubernetes RBAC for the capability role and a cluster registration
 *     Secret, so the local cluster is a valid Application destination
 *     (destination name "in-cluster")
 */
export class ArgoCdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ArgoCdStackProps) {
    super(scope, id, props);

    const clusterName = props.cluster.clusterName;
    const clusterArn = `arn:aws:eks:${this.region}:${this.account}:cluster/${clusterName}`;

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
    const capability = new eks.CfnCapability(this, "ArgoCdCapability", {
      clusterName,
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

    // Grant the capability role Kubernetes RBAC on the cluster. The capability
    // auto-creates an EKS access entry for this role but with NO permissions,
    // so ArgoCD cannot deploy until a policy is associated. The access entry
    // already exists, so associate the policy via the EKS API (a standalone
    // CfnAccessEntry would conflict with the existing one). Cluster-admin is
    // used for simplicity; scope down for production.
    const associatePolicy = new cr.AwsCustomResource(
      this,
      "ArgoCdRoleClusterAdmin",
      {
        onUpdate: {
          service: "EKS",
          action: "associateAccessPolicy",
          parameters: {
            clusterName,
            principalArn: capabilityRole.roleArn,
            policyArn:
              "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy",
            accessScope: { type: "cluster" },
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${clusterName}-argocd-admin`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["eks:AssociateAccessPolicy", "eks:DisassociateAccessPolicy"],
            resources: ["*"],
          }),
        ]),
      },
    );
    associatePolicy.node.addDependency(capability);

    // Register the local cluster as an ArgoCD deployment destination named
    // "in-cluster". The capability does NOT auto-register it. The Secret must
    // use the EKS cluster ARN (the managed capability identifies clusters by
    // ARN; the kubernetes API URL is not supported).
    //
    // Created as a KubernetesManifest scoped to this stack so the resource
    // lives here (with a dependency on the capability) rather than in the EKS
    // stack; CDK imports the cluster's kubectl provider across stacks.
    const clusterSecret = new eks.KubernetesManifest(
      this,
      "ArgoCdInClusterSecret",
      {
        cluster: props.cluster,
        manifest: [
          {
            apiVersion: "v1",
            kind: "Secret",
            metadata: {
              name: "in-cluster",
              namespace: "argocd",
              labels: { "argocd.argoproj.io/secret-type": "cluster" },
            },
            stringData: {
              name: "in-cluster",
              server: clusterArn,
              project: "default",
            },
          },
        ],
      },
    );
    clusterSecret.node.addDependency(capability);

    new cdk.CfnOutput(this, "ArgoCdCapabilityName", {
      value: "argocd",
      description: "Name of the ArgoCD EKS capability",
    });
  }
}
