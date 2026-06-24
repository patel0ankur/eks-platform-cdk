import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { config } from "./config";

export interface LambdaStackProps extends cdk.StackProps {
  /** Name of the CodeBuild project to trigger (from CodeBuildStack). */
  readonly codeBuildProjectName: string;
  /** ARN of that CodeBuild project, used to scope the Lambda's permission. */
  readonly codeBuildProjectArn: string;
}

/**
 * LambdaStack — automation that runs during stack deployment.
 *
 * CloudFormation can create resources but cannot perform actions. This stack
 * adds a Lambda function wired to a CloudFormation Custom Resource so that an
 * action runs as part of `cdk deploy`: it starts the CodeBuild image build,
 * so an image is produced in ECR without anyone running a CLI command.
 *
 * Creates:
 *   - A Lambda execution role scoped to start the CodeBuild project + log
 *   - A Lambda function that calls codebuild:StartBuild
 *   - A Custom Resource that invokes the function on create/update
 */
export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Execution role for the Lambda: start only the target CodeBuild project,
    // and write its own logs to CloudWatch.
    const fnRole = new iam.Role(this, "TriggerFnRole", {
      roleName: `${config.prefix}-build-trigger-role`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Execution role for the CodeBuild trigger Lambda",
    });
    fnRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["codebuild:StartBuild"],
        resources: [props.codeBuildProjectArn],
      }),
    );
    fnRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
        ],
      }),
    );

    // Log group for the function, with a fixed name matching the convention
    // Lambda uses (/aws/lambda/<function-name>) and a one-week retention.
    const logGroup = new logs.LogGroup(this, "BuildTriggerLogs", {
      logGroupName: `/aws/lambda/${config.prefix}-build-trigger`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // The Lambda function. Inline Python so the source is visible in the
    // template; CloudFormation provides the `cfnresponse` module for inline
    // functions, which is used to report success/failure back to the stack.
    //
    // Behaviour:
    //   Create/Update -> start the build (fire-and-forget) and report success.
    //                    The build runs asynchronously; the deploy does not
    //                    wait for it to finish.
    //   Delete        -> nothing to undo; report success.
    // Any exception is caught so a response is always sent and the stack does
    // not hang waiting on the custom resource.
    const triggerFn = new lambda.Function(this, "BuildTriggerFn", {
      functionName: `${config.prefix}-build-trigger`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.handler",
      role: fnRole,
      timeout: cdk.Duration.minutes(2),
      logGroup,
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse

def handler(event, context):
    request_type = event.get("RequestType")
    project = event["ResourceProperties"].get("ProjectName")
    try:
        if request_type in ("Create", "Update"):
            build = boto3.client("codebuild").start_build(projectName=project)
            build_id = build["build"]["id"]
            print(f"Started build {build_id} for project {project}")
            cfnresponse.send(event, context, cfnresponse.SUCCESS,
                             {"BuildId": build_id}, physicalResourceId=project)
        else:  # Delete
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {},
                             physicalResourceId=project)
    except Exception as e:
        print(f"Error: {e}")
        # Report success on failure too, so a build problem does not block the
        # stack. The build can be started manually if needed.
        cfnresponse.send(event, context, cfnresponse.SUCCESS,
                         {"Error": str(e)}, physicalResourceId=project or "none")
`),
    });

    // Custom Resource: invokes the Lambda during deploy. ProjectName is passed
    // as a property and read by the function above.
    new cdk.CustomResource(this, "TriggerBuild", {
      serviceToken: triggerFn.functionArn,
      properties: {
        ProjectName: props.codeBuildProjectName,
      },
    });

    new cdk.CfnOutput(this, "BuildTriggerFunctionName", {
      value: triggerFn.functionName,
      description: "Lambda that starts the CodeBuild build on deploy",
    });
  }
}
