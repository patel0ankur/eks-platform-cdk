import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as identitystore from "aws-cdk-lib/aws-identitystore";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { config } from "./config";

/**
 * IdcStack — IAM Identity Center groups for ArgoCD RBAC.
 *
 * The platform's ArgoCD runs as an EKS Capability, which authenticates and
 * authorizes users through IAM Identity Center (IDC). This stack:
 *   - Looks up the account's existing IDC instance (the instance itself is an
 *     account/organization-level resource and must already exist; it is not
 *     created here).
 *   - Creates three groups used to map IDC users to ArgoCD roles:
 *       admin  -> ArgoCD ADMIN
 *       editor -> ArgoCD EDITOR
 *       viewer -> ArgoCD VIEWER
 *
 * The instance ARN and group IDs are exposed for the ArgoCD stack to consume.
 */
export class IdcStack extends cdk.Stack {
  public readonly instanceArn: string;
  public readonly adminGroupId: string;
  public readonly editorGroupId: string;
  public readonly viewerGroupId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Look up the existing IDC instance at deploy time via sso-admin
    // ListInstances, rather than hardcoding the ARN. Keeps the project
    // portable across accounts.
    const lookup = new cr.AwsCustomResource(this, "IdcInstanceLookup", {
      onUpdate: {
        service: "SSOAdmin",
        action: "listInstances",
        physicalResourceId: cr.PhysicalResourceId.of("idc-instance-lookup"),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    // ListInstances returns Instances[0].{InstanceArn, IdentityStoreId}.
    this.instanceArn = lookup.getResponseField("Instances.0.InstanceArn");
    const identityStoreId = lookup.getResponseField(
      "Instances.0.IdentityStoreId",
    );

    // Three groups mapped to ArgoCD roles by the ArgoCD capability.
    const adminGroup = new identitystore.CfnGroup(this, "AdminGroup", {
      identityStoreId,
      displayName: "admin",
      description: "Platform admins — ArgoCD ADMIN role",
    });
    const editorGroup = new identitystore.CfnGroup(this, "EditorGroup", {
      identityStoreId,
      displayName: "editor",
      description: "Developers — ArgoCD EDITOR role",
    });
    const viewerGroup = new identitystore.CfnGroup(this, "ViewerGroup", {
      identityStoreId,
      displayName: "viewer",
      description: "Read-only users — ArgoCD VIEWER role",
    });

    this.adminGroupId = adminGroup.attrGroupId;
    this.editorGroupId = editorGroup.attrGroupId;
    this.viewerGroupId = viewerGroup.attrGroupId;

    // Create the ArgoCD admin user. Identity Center users are not supported by
    // CloudFormation, so create one through the identitystore CreateUser SDK
    // call via a custom resource. DeleteUser is called on stack removal.
    const adminUser = new cr.AwsCustomResource(this, "ArgoCdAdminUser", {
      onCreate: {
        service: "identitystore",
        action: "createUser",
        parameters: {
          IdentityStoreId: identityStoreId,
          UserName: config.argocdAdmin.userName,
          DisplayName: `${config.argocdAdmin.givenName} ${config.argocdAdmin.familyName}`,
          Name: {
            GivenName: config.argocdAdmin.givenName,
            FamilyName: config.argocdAdmin.familyName,
          },
          Emails: [{ Value: config.argocdAdmin.email, Primary: true }],
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse("UserId"),
      },
      onDelete: {
        service: "identitystore",
        action: "deleteUser",
        parameters: {
          IdentityStoreId: identityStoreId,
          UserId: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "identitystore:CreateUser",
            "identitystore:DeleteUser",
            "identitystore:DescribeUser",
          ],
          resources: ["*"],
        }),
      ]),
    });
    const adminUserId = adminUser.getResponseField("UserId");

    // Add the admin user to the admin group so it gets the ArgoCD ADMIN role.
    new identitystore.CfnGroupMembership(this, "AdminMembership", {
      identityStoreId,
      groupId: this.adminGroupId,
      memberId: { userId: adminUserId },
    });

    new cdk.CfnOutput(this, "ArgoCdAdminUserName", {
      value: config.argocdAdmin.userName,
      description: "Identity Center user with ArgoCD ADMIN role (set its password to sign in)",
    });
    new cdk.CfnOutput(this, "IdcInstanceArn", {
      value: this.instanceArn,
      description: "IAM Identity Center instance ARN",
    });
    new cdk.CfnOutput(this, "AdminGroupId", { value: this.adminGroupId });
    new cdk.CfnOutput(this, "EditorGroupId", { value: this.editorGroupId });
    new cdk.CfnOutput(this, "ViewerGroupId", { value: this.viewerGroupId });
  }
}
