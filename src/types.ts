import { FromSchema, JSONSchema7 } from "json-schema-to-ts";

export const crawlSchema = {
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    },
    "start_url": {
      "type": "string"
    },
    "status": {
      "enum": [
        "running",
        "completed",
        "stopped"
      ],
      "type": "string"
    },
    "visited": {
      "type": "number"
    },
    "created": {
      "format": "date-time",
      "type": "string"
    },
    "queue_url": {
      "type": "string"
    },
    "dlq_url": {
      "type": "string"
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
    "content_key": {
      "type": "string"
    },
    "links": {
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "status": {
      "enum": [
        "queued",
        "crawling",
        "failed",
        "completed"
      ],
      "type": "string"
    },
    "url": {
      "type": "string"
    },
    "visited": {
      "format": "date-time",
      "type": "string"
    },
    "id": {
      "type": "string"
    },
    "crawl_id": {
      "type": "string"
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
      "type": "string"
    },
    "links": {
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "url": {
      "type": "string"
    }
  },
  "required": [
    "url",
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
      "type": "string"
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