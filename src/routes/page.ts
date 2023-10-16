
import { FastifyInstance } from 'fastify';
import { dynamodb, s3 } from '../clients';
import { Crawl, Page, PageSubmission, pageSchema, pageSubmissionSchema } from '../types';
import { QueryCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import config from '../config';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { queueUrlToCrawl, unmarshallPage } from '../util';

export const routes = (server: FastifyInstance, _: any, done: () => void) => {
  server.get<{
    Params: { id: string },
    Querystring: { hydrate?: boolean },
    Response: Page
  }>(
    "/page/:id",
    {
      schema: {
        params: {
          id: {
            type: "string",
            description: "The ID of the page to retrieve"
          }
        },
        querystring: {
          hydrate: {
            type: "boolean",
            default: false,
            description: "Whether to retrieve the page content from S3"
          }
        },
        response: {
          200: pageSchema
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;

      const getCmd = new GetItemCommand({
        TableName: config.aws.dynamodb.pagesTable,
        Key: {
          id: { S: id }
        }
      });

      let pageItem;
      try {
        pageItem = await dynamodb.send(getCmd);
      } catch (e) {
        throw new Error("An error was encountered while retrieving the page");
      }

      if (!pageItem.Item) {
        return reply.code(404).send({
          error: "Page not found"
        });
      }

      const page: Page = unmarshallPage(pageItem.Item);

      if (page.content_key && req.query.hydrate) {
        // Get the content from S3
        const getCmd = new GetObjectCommand({
          Bucket: config.aws.s3.bucket,
          Key: page.content_key
        });

        let object;
        try {
          object = await s3.send(getCmd);
        } catch (e) {
          throw new Error("An error was encountered while retrieving the page content");
        }

        page.content = await object.Body?.transformToString();
      }

      return page;
    }
  );

  server.put<{
    Params: { id: string },
    Body: PageSubmission,
    Response: Page
  }>(
    "/page/:id",
    {
      schema: {
        params: {
          id: {
            type: "string",
            description: "The ID of the page to update"
          }
        },
        body: pageSubmissionSchema,
        response: {
          200: pageSchema
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;
      const { content, links, url } = req.body;

      // Upload the content to S3
      const contentKey = `${id}.html`;
      const putCmd = new PutObjectCommand({
        Bucket: config.aws.s3.bucket,
        Key: contentKey,
        Body: content
      });

      try {
        await s3.send(putCmd);
      } catch (e) {
        throw new Error("An error was encountered while uploading the page content");
      }

      // Filter the links to unique links, and strip anchor tags
      const uniqueLinks = Array.from(new Set(links.map(link => {
        try {
          const url = new URL(link);
          url.hash = "";
          return url.toString();
        } catch (e) {
          return "";
        }
      }).filter(link => link !== "")));

      // Update the page in DynamoDB
      const updateCmd = new UpdateItemCommand({
        TableName: config.aws.dynamodb.pagesTable,
        Key: {
          id: { S: id }
        },
        UpdateExpression: "SET #status = :status, #links = :links, #content_key = :content_key",
        ExpressionAttributeNames: {
          "#status": "status",
          "#links": "links",
          "#content_key": "content_key"
        },
        ExpressionAttributeValues: {
          ":status": { S: "completed" },
          ":links": { SS: uniqueLinks },
          ":content_key": { S: contentKey },
        },
        ReturnValues: "ALL_NEW"
      });

      let page: Page;
      try {
        const { Attributes } = await dynamodb.send(updateCmd);
        if (!Attributes) {
          throw new Error("An error was encountered while updating the page");
        }
        page = unmarshallPage(Attributes);
      } catch (e) {
        throw new Error("An error was encountered while updating the page");
      }

      const linkResults = await Promise.allSettled(uniqueLinks.map(link => queueUrlToCrawl(page.crawl_id!, link, (page.depth || 0) + 1)));
      const errors = linkResults.filter(result => result.status === "rejected").map((result: any) => result.reason);

      errors.forEach(error => {
        console.error(error);
      });

      return page;
    }
  );


  done();
}
