########################################################################
# codebuild.tf — CI that turns application source into a container image.
#
# Creates:
#   - An ECR repository to store built images
#   - A CodeBuild project whose inline buildspec clones a repo, builds the
#     image, and pushes it to ECR
#
# The CodeBuild role is defined in iam.tf (aws_iam_role.codebuild).
########################################################################

# ECR repository holding the built images. Worker nodes pull images from here
# using the node role's ECR read permission.
resource "aws_ecr_repository" "app" {
  name = var.ecr_repo_name

  # Scan images for known vulnerabilities on every push.
  image_scanning_configuration {
    scan_on_push = true
  }

  # Delete the repository and its images when destroyed.
  force_delete = true
}

# Retain only the 10 most recent images to limit storage cost.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Inline buildspec — the commands CodeBuild runs in its build container:
# log in to ECR, clone the source repo, build the image, push it to ECR.
# SOURCE_REPO_URL and IMAGE_TAG are environment variables, so one project can
# build any repository.
locals {
  app_buildspec = yamlencode({
    version = "0.2"
    phases = {
      pre_build = {
        commands = [
          "echo \"Logging in to Amazon ECR...\"",
          "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
          "export REPO_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME",
          "echo \"Cloning source: $SOURCE_REPO_URL\"",
          "git clone --depth 1 $SOURCE_REPO_URL app-src && cd app-src",
        ]
      }
      build = {
        commands = [
          "echo \"Building image $REPO_URI:$IMAGE_TAG ...\"",
          "docker build -t $REPO_URI:$IMAGE_TAG .",
        ]
      }
      post_build = {
        commands = [
          "echo \"Pushing image to ECR...\"",
          "docker push $REPO_URI:$IMAGE_TAG",
          "echo \"Done. Image: $REPO_URI:$IMAGE_TAG\"",
        ]
      }
    }
  })
}

# The CodeBuild project. No source repository is configured (NO_SOURCE): the
# buildspec clones SOURCE_REPO_URL itself.
resource "aws_codebuild_project" "image_builder" {
  name         = "${var.prefix}-image-builder"
  description  = "Builds application container images and pushes them to ECR"
  service_role = aws_iam_role.codebuild.arn

  build_timeout = 30 # minutes

  artifacts {
    type = "NO_ARTIFACTS"
  }

  source {
    type      = "NO_SOURCE"
    buildspec = local.app_buildspec
  }

  environment {
    image           = "aws/codebuild/standard:7.0"
    compute_type    = "BUILD_GENERAL1_SMALL"
    type            = "LINUX_CONTAINER"
    privileged_mode = true # required for `docker build`

    # Default values; override per run with `aws codebuild start-build
    # --environment-variables-override`.
    environment_variable {
      name  = "AWS_ACCOUNT_ID"
      value = local.account_id
    }
    environment_variable {
      name  = "ECR_REPO_NAME"
      value = var.ecr_repo_name
    }
    environment_variable {
      name  = "IMAGE_TAG"
      value = "latest"
    }
    # The repository to build. Defaults to a public sample app.
    environment_variable {
      name  = "SOURCE_REPO_URL"
      value = "https://github.com/aws-containers/retail-store-sample-app.git"
    }
  }
}
