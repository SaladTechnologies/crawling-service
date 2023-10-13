import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { SQSClient } from "@aws-sdk/client-sqs"
import config from "./config"

export const s3 = new S3Client({ region: config.aws.region })
export const dynamodb = new DynamoDBClient({ region: config.aws.region })
export const sqs = new SQSClient({ region: config.aws.region })