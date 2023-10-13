
import { FastifyInstance } from 'fastify';
import { dynamodb } from '../clients';
import { Page, pageSchema } from '../types';
import { QueryCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import config from '../config';


export const routes = (server: FastifyInstance, options: any, done: () => void) => {
  server.get<{ Params: { id: string }, Response: Page }>(
    "/page/:id",
    {
      schema: {
        params: {
          id: {
            type: "string"
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

      const page: Page = {
        id: pageItem.Item.id.S!,
        crawl_id: pageItem.Item.crawl_id.S!,
        url: pageItem.Item.url.S!,
        links: pageItem.Item.links.SS || [],
        status: pageItem.Item.status.S as "queued" | "crawling" | "failed",
        content_key: pageItem.Item.content_key.S,
        visited: pageItem.Item.visited.S
      };

      return page;
    }
  );

  done();
}
