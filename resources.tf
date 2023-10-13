terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = ">5"
    }
  }
}

terraform {
  backend "s3" {
    profile="tofu"
    bucket = "salad-demo-tf-state"
    key = "crawler.tfstate"
    region = "us-east-2"
  }
}

provider "aws" {
  profile="tofu"
  region = "us-east-2"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_dynamodb_table" "crawls" {
  name = "crawls"
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "id"

  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "id"
    type = "S"
  }

  global_secondary_index {
    name = "status-index"
    hash_key = "status"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "pages" {
  name = "pages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "id"
  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "crawl_id"
    type = "S"
  }

  attribute {
    name = "url"
    type = "S"
  }

  attribute {
    name = "visited"
    type = "N"
  }

  global_secondary_index {
    name = "crawl_id-index"
    hash_key = "crawl_id"
    range_key = "visited"
    projection_type = "ALL"
  }

  global_secondary_index {
    name = "url-index"
    hash_key = "url"
    range_key = "visited"
    projection_type = "ALL"
  }
}

resource "aws_s3_bucket" "page-data" {
  bucket = "salad-crawler-page-data"
}

data "aws_iam_policy_document" "crawler-service-permissions" {
  statement {
    sid = "s3Stuff"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
    ]
    resources = [
      "${aws_s3_bucket.page-data.arn}/*",
    ]
  }

  statement {
    sid = "dynamoStuff"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      "${aws_dynamodb_table.crawls.arn}",
      "${aws_dynamodb_table.pages.arn}",
    ]
  }

  statement {
    sid = "sqsStuff"

    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:SendMessageBatch",
      "sqs:GetQueueUrl",
      "sqs:CreateQueue",
      "sqs:GetQueueAttributes",
    ]

    resources = [
      "arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:crawl-queue-*",
    ]
  }
}

resource "aws_iam_user" "crawler-service" {
  name = "crawler-service"
}

resource "aws_iam_user_policy" "crawler-service-permissions" {
  name = "crawler-service-permissions"
  user = aws_iam_user.crawler-service.name
  policy = data.aws_iam_policy_document.crawler-service-permissions.json
}

resource "aws_iam_access_key" "crawler-service" {
  user = aws_iam_user.crawler-service.name
}

output "crawler-service-access-key" {
  value = aws_iam_access_key.crawler-service.id
  sensitive = true
}

output "crawler-service-secret-key" {
  value = aws_iam_access_key.crawler-service.secret
  sensitive = true
}