########################################################################
# iam.tf — cross-cutting IAM roles not owned by a single component.
#
#   - codebuild_role : assumed by CodeBuild to build and push images
#
# The EKS cluster and node roles are defined in eks.tf instead, because EKS
# couples them to the cluster (via aws-auth/access entries).
########################################################################

# Trust policy: CodeBuild service assumes this role.
data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

# CodeBuild service role, scoped to building and pushing images.
resource "aws_iam_role" "codebuild" {
  name               = "${var.prefix}-codebuild-role"
  description        = "Role assumed by CodeBuild CI projects"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

# Permission policy for the CodeBuild role:
#   - stream build logs to CloudWatch Logs
#   - obtain an ECR login token (account-level, must use "*")
#   - push/pull images to/from repositories under the project prefix
data "aws_iam_policy_document" "codebuild" {
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:CreateRepository",
      "ecr:DescribeRepositories",
    ]
    # Scoped to repositories whose names start with the project prefix.
    resources = [
      "arn:${local.partition}:ecr:${local.region}:${local.account_id}:repository/${var.prefix}-*",
    ]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name   = "${var.prefix}-codebuild-policy"
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}
