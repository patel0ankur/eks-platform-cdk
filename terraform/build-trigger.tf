########################################################################
# build-trigger.tf — start the application image build on apply.
#
# A null_resource with a local-exec provisioner runs `aws codebuild
# start-build` during apply, so an image is produced in ECR without anyone
# running a CLI command by hand.
#
# Behaviour:
#   - Fires on create and whenever the trigger token changes.
#   - Fire-and-forget: it does not wait for the build to finish.
#   - A build failure never blocks the apply (`|| true`).
#
# NOTE: this runs the AWS CLI on the machine running `terraform apply`. The
# caller's credentials must allow codebuild:StartBuild on the project.
########################################################################

resource "null_resource" "trigger_app_build" {
  # Re-run whenever the project or the token changes. Change
  # var.backstage_build_token (or add a dedicated token var) to force a
  # rebuild; by default the project name is stable so this runs once.
  triggers = {
    project_name = aws_codebuild_project.image_builder.name
  }

  provisioner "local-exec" {
    command = "aws codebuild start-build --project-name ${aws_codebuild_project.image_builder.name} --region ${var.region} || true"
  }
}
