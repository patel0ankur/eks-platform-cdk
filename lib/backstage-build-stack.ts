import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { config } from "./config";

export interface BackstageBuildStackProps extends cdk.StackProps {
  /** ARN of the CodeBuild service role (from IamStack). */
  readonly codeBuildRoleArn: string;
}

/**
 * BackstageBuildStack — builds the Backstage container image and pushes it to
 * ECR, automatically on deploy.
 *
 * The build context is the `backstage/` folder in this repo — our own Backstage
 * monorepo (scaffolded from @backstage/create-app, Apache-2.0) with a multi-stage
 * Dockerfile that builds the app from source (no external clone). A build can
 * take ~10-15 minutes, so a Lambda-backed custom resource starts the build
 * during deploy and does not wait for it — the image lands in ECR asynchronously,
 * where ArgoCD's Backstage Deployment pulls it.
 *
 * Creates:
 *   - An ECR repository for the Backstage image
 *   - A CodeBuild project that clones this repo and builds backstage/
 *   - A Lambda + custom resource that triggers the build on deploy
 */
export class BackstageBuildStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: BackstageBuildStackProps) {
    super(scope, id, props);

    const codeBuildRole = iam.Role.fromRoleArn(
      this,
      "ImportedCodeBuildRole",
      props.codeBuildRoleArn,
      { mutable: false },
    );

    this.repository = new ecr.Repository(this, "BackstageRepo", {
      repositoryName: config.backstageEcrRepoName,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Buildspec: log in to ECR, clone this repo, build the backstage/ folder
    // (multi-arch is unnecessary here — nodes are amd64), push to ECR.
    const buildSpec = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        pre_build: {
          commands: [
            'echo "Logging in to Amazon ECR..."',
            "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
            "export REPO_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME",
            'echo "Cloning $SOURCE_REPO_URL ($SOURCE_REVISION)"',
            "git clone --depth 1 --branch $SOURCE_REVISION $SOURCE_REPO_URL src",
          ],
        },
        build: {
          commands: [
            'echo "Building Backstage image $REPO_URI:$IMAGE_TAG ..."',
            "docker build -t $REPO_URI:$IMAGE_TAG src/backstage",
          ],
        },
        post_build: {
          commands: [
            "docker push $REPO_URI:$IMAGE_TAG",
            'echo "Image successfully pushed: $REPO_URI:$IMAGE_TAG"',
          ],
        },
      },
    });

    const project = new codebuild.Project(this, "BackstageBuilder", {
      projectName: `${config.prefix}-backstage-builder`,
      description: "Builds the Backstage container image and pushes it to ECR",
      role: codeBuildRole,
      buildSpec,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        // Larger compute — the Backstage yarn build is heavy.
        computeType: codebuild.ComputeType.LARGE,
        privileged: true, // required for docker build
      },
      environmentVariables: {
        AWS_ACCOUNT_ID: { value: this.account },
        ECR_REPO_NAME: { value: config.backstageEcrRepoName },
        IMAGE_TAG: { value: "latest" },
        SOURCE_REPO_URL: { value: config.gitops.repoUrl },
        SOURCE_REVISION: { value: config.gitops.revision },
      },
      timeout: cdk.Duration.minutes(45),
    });

    // Lambda that starts the build, fired by a custom resource on deploy.
    const triggerRole = new iam.Role(this, "BuildTriggerRole", {
      roleName: `${config.prefix}-backstage-build-trigger-role`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    triggerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["codebuild:StartBuild"],
        resources: [project.projectArn],
      }),
    );
    const triggerLogs = new logs.LogGroup(this, "BuildTriggerLogs", {
      logGroupName: `/aws/lambda/${config.prefix}-backstage-build-trigger`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    triggerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [triggerLogs.logGroupArn],
      }),
    );

    const triggerFn = new lambda.Function(this, "BuildTriggerFn", {
      functionName: `${config.prefix}-backstage-build-trigger`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.handler",
      role: triggerRole,
      timeout: cdk.Duration.minutes(2),
      logGroup: triggerLogs,
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse

def handler(event, context):
    project = event["ResourceProperties"].get("ProjectName")
    try:
        if event["RequestType"] in ("Create", "Update"):
            build = boto3.client("codebuild").start_build(projectName=project)
            print(f"Started build {build['build']['id']} for {project}")
            cfnresponse.send(event, context, cfnresponse.SUCCESS,
                             {"BuildId": build["build"]["id"]}, physicalResourceId=project)
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physicalResourceId=project)
    except Exception as e:
        print(f"Error: {e}")
        # Report success so a build problem never blocks the stack; the build
        # can be started manually if needed.
        cfnresponse.send(event, context, cfnresponse.SUCCESS,
                         {"Error": str(e)}, physicalResourceId=project or "none")
`),
    });

    // Custom resource that invokes the Lambda on create/update (same pattern as
    // the application build trigger). The Lambda reports back via cfnresponse.
    new cdk.CustomResource(this, "TriggerBackstageBuild", {
      serviceToken: triggerFn.functionArn,
      properties: {
        ProjectName: project.projectName,
      },
    });

    new cdk.CfnOutput(this, "BackstageEcrUri", {
      value: this.repository.repositoryUri,
      description: "ECR repository URI for the Backstage image",
    });
    new cdk.CfnOutput(this, "BackstageBuildProject", {
      value: project.projectName,
    });
  }
}
