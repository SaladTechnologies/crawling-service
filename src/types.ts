import { FromSchema, JSONSchema7 } from "json-schema-to-ts";

export const crawlSchema = {
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "The ID of the crawl",
      "format": "uuid"
    },
    "start_url": {
      "type": "string",
      "description": "The URL to start crawling",
      "format": "uri"
    },
    "max_depth": {
      "type": "number",
      "description": "The maximum depth to crawl",
      "minimum": -1,
      "default": 10
    },
    "max_pages": {
      "type": "number",
      "description": "The maximum number of pages to crawl",
      "minimum": -1,
      "default": 1000
    },
    "same_domain": {
      "type": "boolean",
      "description": "Whether to only crawl pages on the same domain as the start URL",
      "default": true
    },
    "status": {
      "enum": [
        "running",
        "completed",
        "stopped"
      ],
      "type": "string",
      "description": "The status of the crawl"
    },
    "visited": {
      "type": "number",
      "description": "The number of pages visited"
    },
    "created": {
      "format": "date-time",
      "type": "string",
      "description": "The date and time the crawl was created"
    },
    "queue_url": {
      "type": "string",
      "description": "The URL of the queue where crawl jobs are sent. Used internally by the API"
    },
    "dlq_url": {
      "type": "string",
      "description": "The URL of the queue where crawl jobs are sent if they fail. Used internally by the API"
    }
  },
  "required": [
    "id",
    "status",
    "start_url",
    "visited",
    "created",
    "queue_url",
    "dlq_url"
  ],
  "type": "object"
} as const satisfies JSONSchema7;

export type Crawl = FromSchema<typeof crawlSchema>;

export const pageSchema = {
  "additionalProperties": false,
  "properties": {
    "content": {
      "type": "string",
      "description": "The content of the page. Only present if the page has been crawled and the content has been stored in S3, and the hydrate query parameter is set to true"
    },
    "content_key": {
      "type": "string",
      "description": "The S3 key where the page content is stored. Only present if the page has been crawled and the content has been stored in S3"
    },
    "links": {
      "items": {
        "type": "string"
      },
      "type": "array",
      "description": "The links found on the page"
    },
    "status": {
      "enum": [
        "queued",
        "crawling",
        "failed",
        "completed"
      ],
      "type": "string",
      "description": "The status of the page crawl"
    },
    "url": {
      "type": "string",
      "description": "The URL of the page"
    },
    "visited": {
      "format": "date-time",
      "type": "string",
      "description": "The date and time the page was crawled"
    },
    "id": {
      "type": "string",
      "description": "The ID of the page",
      "format": "uuid"
    },
    "crawl_id": {
      "type": "string",
      "description": "The ID of the crawl. Foreign key to the crawl table"
    },
    "depth": {
      "type": "number",
      "description": "The depth of the page crawl. Used to comply with Crawl.max_depth",
      "minimum": 0
    }
  },
  "required": [
    "url",
    "links",
    "status",
    "crawl_id",
    "id"
  ],
  "type": "object"
} as const satisfies JSONSchema7;

export type Page = FromSchema<typeof pageSchema>;

export const pageSubmissionSchema = {
  "additionalProperties": false,
  "properties": {
    "content": {
      "type": "string",
      "description": "The text content of the page"
    },
    "links": {
      "items": {
        "type": "string",
      },
      "type": "array",
      "description": "The links found on the page"
    },

  },
  "required": [
    "content",
    "links"
  ],
  "type": "object"
} as const satisfies JSONSchema7;

export type PageSubmission = FromSchema<typeof pageSubmissionSchema>;

export const crawlSubmissionSchema = {
  "additionalProperties": false,
  "properties": {
    "start_url": {
      "type": "string",
      "description": "The URL to start crawling",
      "format": "uri"
    },
    "max_depth": {
      "type": "number",
      "description": "The maximum depth to crawl",
      "minimum": -1,
      "default": 10
    },
    "max_pages": {
      "type": "number",
      "description": "The maximum number of pages to crawl",
      "minimum": -1,
      "default": 1000
    },
    "same_domain": {
      "type": "boolean",
      "description": "Whether to only crawl pages on the same domain as the start URL",
      "default": true
    }
  },
  "required": [
    "start_url"
  ],
  "type": "object"
} as const satisfies JSONSchema7;

export type CrawlSubmission = FromSchema<typeof crawlSubmissionSchema>;

export const crawlJobSchema = {
  "additionalProperties": false,
  "properties": {
    "crawl_id": {
      "type": "string"
    },
    "page_id": {
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "delete_id": {
      "type": "string"
    }
    
  },
  "required": [
    "crawl_id",
    "page_id",
    "url",
  ],
  "type": "object"
} as const satisfies JSONSchema7;

export type CrawlJob = FromSchema<typeof crawlJobSchema>;