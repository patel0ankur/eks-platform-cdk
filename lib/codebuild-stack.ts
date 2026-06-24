import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { config } from "./config";

export interface CodeBuildStackProps extends cdk.StackProps {
  /**
   * ARN of the CodeBuild service role (from IamStack).
   *
   * The ARN string is passed rather than the Role object so the role can be
   * imported as immutable below. An immutable import prevents CodeBuild from
   * appending policies to a role that lives in another stack, which would
   * create a circular dependency between the two stacks.
   */
  readonly codeBuildRoleArn: string;
}

/**
 * CodeBuildStack — CI that turns application source into a container image.
 *
 * Creates:
 *   - An ECR repository to store built images
 *   - A CodeBuild project whose inline buildspec clones a repo, builds the
 *     image, and pushes it to ECR
 */
export class CodeBuildStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly project: codebuild.Project;

  constructor(scope: Construct, id: string, props: CodeBuildStackProps) {
    super(scope, id, props);

    // Import the role as immutable so CodeBuild does not modify its policies.
    const codeBuildRole = iam.Role.fromRoleArn(
      this,
      "ImportedCodeBuildRole",
      props.codeBuildRoleArn,
      { mutable: false },
    );

    // ECR repository holding the built images. Worker nodes pull images from
    // here using the node role's ECR read permission.
    this.repository = new ecr.Repository(this, "AppRepo", {
      repositoryName: config.ecrRepoName,

      // Scan images for known vulnerabilities on every push.
      imageScanOnPush: true,

      // Retain only the 10 most recent images to limit storage cost.
      lifecycleRules: [{ maxImageCount: 10 }],

      // Delete the repository and its images when the stack is destroyed.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Inline buildspec — the commands CodeBuild runs in its build container:
    // log in to ECR, clone the source repo, build the image, push it to ECR.
    // SOURCE_REPO_URL and IMAGE_TAG are environment variables, so one project
    // can build any repository.
    const buildSpec = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        pre_build: {
          commands: [
            'echo "Logging in to Amazon ECR..."',
            "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
            "export REPO_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME",
            'echo "Cloning source: $SOURCE_REPO_URL"',
            "git clone --depth 1 $SOURCE_REPO_URL app-src && cd app-src",
          ],
        },
        build: {
          commands: [
            'echo "Building image $REPO_URI:$IMAGE_TAG ..."',
            "docker build -t $REPO_URI:$IMAGE_TAG .",
          ],
        },
        post_build: {
          commands: [
            'echo "Pushing image to ECR..."',
            "docker push $REPO_URI:$IMAGE_TAG",
            'echo "Done. Image: $REPO_URI:$IMAGE_TAG"',
          ],
        },
      },
    });

    // The CodeBuild project.
    this.project = new codebuild.Project(this, "ImageBuilder", {
      projectName: `${config.prefix}-image-builder`,
      description: "Builds application container images and pushes them to ECR",

      role: codeBuildRole,

      // No `source` property: the buildspec clones SOURCE_REPO_URL itself, so
      // the project defaults to a NO_SOURCE source driven entirely by the
      // inline buildspec.
      buildSpec,

      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        // Required for `docker build`, which needs the Docker daemon.
        privileged: true,
      },

      // Default values; override per run with --environment-variables-override.
      environmentVariables: {
        AWS_ACCOUNT_ID: { value: this.account },
        ECR_REPO_NAME: { value: config.ecrRepoName },
        IMAGE_TAG: { value: "latest" },
        // The repository to build. Defaults to a public sample app.
        SOURCE_REPO_URL: {
          value: "https://github.com/aws-containers/retail-store-sample-app.git",
        },
      },

      timeout: cdk.Duration.minutes(30),
    });

    // Stack outputs: the ECR URI and the project name used to start a build.
    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: this.repository.repositoryUri,
      description: "ECR repository URI where images are pushed",
    });
    new cdk.CfnOutput(this, "CodeBuildProjectName", {
      value: this.project.projectName,
      description: "CodeBuild project name (use with: aws codebuild start-build)",
    });
  }
}
