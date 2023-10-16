import { FastifyInstance } from "fastify";
import { sqs, dynamodb } from "../clients";
import NodeCache from "node-cache";
import { Crawl, CrawlJob, crawlJobSchema } from "../types";
import { getRunningCrawls, getQueueUrl } from "../util";
import { ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import config from "../config";

const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 0,
  useClones: false,
});

export const routes = (server: FastifyInstance,  _: any, done: () => void ) => {
  server.get<{ Querystring: { crawl?: string, num?: number }, Response: CrawlJob[]}>(
    "/job",
    {
      schema: {
        querystring: {
          crawl: {
            type: "string"
          },
          num: {
            type: "number",
            default: 1,
            minimum: 1,
            maximum: 10
          }
        },
        response: {
          200: {
            type: "array",
            items: crawlJobSchema
          }
        }
      },
    },
    async (req, reply) => {
      let { crawl, num } = req.query;
      if (!crawl) {
        let runningCrawls = cache.get("runningCrawls") as Crawl[];
        if (!runningCrawls) {
          runningCrawls = await getRunningCrawls();
          cache.set("runningCrawls", runningCrawls);
        }

        // This is where you would implement logic to determine which crawl to hand out a job for.
        // For now, we return randomly.

        const randomCrawl = runningCrawls[Math.floor(Math.random() * runningCrawls.length)];
        crawl = randomCrawl.id;
      }

      const queueUrl = await getQueueUrl(crawl);

      const getCmd = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: num,
        WaitTimeSeconds: 1
      });

      const messages = await sqs.send(getCmd);
      if (!messages.Messages) {
        return [];
      }

      const jobs: CrawlJob[] = messages.Messages.map(message => {
        const body = JSON.parse(message.Body || "{}");
        return {
          page_id: body.page_id,
          crawl_id: body.crawl_id,
          url: body.url,
          delete_id: message.ReceiptHandle!
        }
      });

      // Mark all pages as crawling
      await Promise.all(jobs.map(async job => {
        const updateCmd = new UpdateItemCommand({
          TableName: config.aws.dynamodb.pagesTable,
          Key: {
            id: { S: job.page_id }
          },
          UpdateExpression: "SET #status = :status, visited = :visited",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":status": { S: "crawling" },
            ":visited": { S: new Date().toISOString() }
          }
        });

        await dynamodb.send(updateCmd);
      }))

      return jobs;
    }
  )

  server.delete<{ Params: { id: string, crawlId: string } }>(
    "/crawl/:crawlId/job/:id",
    {
      schema: {
        params: {
          id: { type: "string" },
          crawlId: { type: "string" },
        },
        response: {
          204: {
            type: "null"
          }
        }
      }
    },
    async (req, reply) => {
      const { id, crawlId } = req.params;

      const queueUrl = await getQueueUrl(crawlId);

      const deleteCmd = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: id
      });

      try {
        await sqs.send(deleteCmd);
      } catch (e: any) {
        e.response = "An error was encountered while deleting the job";
        throw e
      }

      return reply.status(204).send();
    }
  );


  done();
};