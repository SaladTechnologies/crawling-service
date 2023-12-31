import { FastifyInstance } from "fastify";
import { sqs, dynamodb } from "../clients";
import NodeCache from "node-cache";
import { Crawl, CrawlJob, crawlJobSchema } from "../types";
import { getRunningCrawls, getQueueUrl, popRandom, getCrawl } from "../util";
import { ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import config from "../config";

const cache = new NodeCache({
  stdTTL: 10,
  checkperiod: 0,
  useClones: false,
});

export const routes = (server: FastifyInstance, _: any, done: () => void) => {
  server.get<{ Querystring: { crawl?: string, num?: number }, Response: CrawlJob[] }>(
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
      let runningCrawls;
      if (!crawl) {
        runningCrawls = cache.get("runningCrawls") as Crawl[];
        if (!runningCrawls) {
          runningCrawls = await getRunningCrawls();
          cache.set("runningCrawls", runningCrawls);
        }

        // This is where you would implement logic to determine which crawl to hand out a job for.
        // For now, we return randomly.
        if (!runningCrawls.length) {
          return [];
        }

        const randomCrawl = runningCrawls[Math.floor(Math.random() * runningCrawls.length)];
        crawl = randomCrawl.id;
      } else {
        runningCrawls = [await getCrawl(crawl)]
      }

      while (runningCrawls.length) {
        const crawlObj = popRandom(runningCrawls) as Crawl;
        crawl = crawlObj.id;

        const queueUrl = await getQueueUrl(crawl);

        const getCmd = new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: num,
          WaitTimeSeconds: 1
        });

        const messages = await sqs.send(getCmd);
        if (!messages.Messages) {
          continue;
        }

        const jobs: CrawlJob[] = messages.Messages.map(message => {
          const body = JSON.parse(message.Body || "{}");
          return {
            page_id: body.page_id,
            crawl_id: body.crawl_id,
            url: body.url,
            delete_id: Buffer.from(message.ReceiptHandle!).toString("base64")
          }
        });

        // Mark all pages as crawling
        await Promise.all(jobs.map(async job => {
          console.log(job);
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
              ":visited": { N: new Date().getTime().toString() }
            }
          });

          return await dynamodb.send(updateCmd);
        }))

        return jobs;
      }

      return [];
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
        ReceiptHandle: Buffer.from(id, "base64").toString("utf8")
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