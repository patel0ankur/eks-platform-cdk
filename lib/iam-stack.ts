import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { config } from "./config";

/**
 * IamStack — cross-cutting IAM roles not owned by a single service stack.
 *
 *   - codeBuildRole : assumed by CodeBuild to build and push images
 *
 * The EKS cluster and node roles are defined in EksStack instead, because EKS
 * couples them to the cluster (via aws-auth/access entries) and keeping them
 * with the cluster avoids a cross-stack dependency cycle.
 *
 * codeBuildRole is exposed as a public property so CodeBuildStack can use it.
 */
export class IamStack extends cdk.Stack {
  public readonly codeBuildRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CodeBuild service role, scoped to building and pushing images: write
    // logs to CloudWatch and push/pull from ECR repositories in this account.
    this.codeBuildRole = new iam.Role(this, "CodeBuildRole", {
      roleName: `${config.prefix}-codebuild-role`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      description: "Role assumed by CodeBuild CI projects",
    });

    // Stream build logs to CloudWatch Logs.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      }),
    );

    // Obtain an ECR login token. This action is account-level and must use
    // "*"; the image push/pull actions below are scoped to specific repos.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:CreateRepository",
          "ecr:DescribeRepositories",
        ],
        // Scoped to repositories whose names start with the project prefix.
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/${config.prefix}-*`,
        ],
      }),
    );

    // Stack output: the CodeBuild role ARN, consumed by CodeBuildStack.
    new cdk.CfnOutput(this, "CodeBuildRoleArn", {
      value: this.codeBuildRole.roleArn,
      description: "ARN of the CodeBuild CI role",
    });
  }
}
