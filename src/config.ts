import assert from "assert";
import { version } from "../package.json";

const {
  AWS_DEFAULT_REGION = 'us-east-2',
  AWS_REGION,
  PORT = '3000',
  HOST = 'localhost',
  PUBLIC_URL = "localhost:3000",
  S3_BUCKET_NAME,
  CRAWL_TABLE_NAME,
  PAGES_TABLE_NAME,
  QUEUE_PREFIX = "crawl-queue-"
} = process.env;

assert(S3_BUCKET_NAME, "S3_BUCKET_NAME is required");
assert(CRAWL_TABLE_NAME, "CRAWL_TABLE_NAME is required");
assert(PAGES_TABLE_NAME, "PAGES_TABLE_NAME is required");

const config = {
  aws: {
    region: AWS_REGION || AWS_DEFAULT_REGION,
    s3: {
      bucket: S3_BUCKET_NAME,
    },
    dynamodb: {
      crawlTable: CRAWL_TABLE_NAME,
      pagesTable: PAGES_TABLE_NAME,
    },
    sqs: {
      queuePrefix: QUEUE_PREFIX,
    },
  },
  server: {
    port: parseInt(PORT),
    host: HOST,
    publicUrl: PUBLIC_URL,
    version
  },
};

export default config;