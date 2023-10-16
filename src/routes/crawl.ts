import { FastifyInstance } from "fastify";
import { sqs, dynamodb } from "../clients";
import { PutItemCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { CreateQueueCommand, GetQueueAttributesCommand, PurgeQueueCommand } from "@aws-sdk/client-sqs";
import config from "../config";
import { Crawl, crawlSchema, CrawlSubmission, crawlSubmissionSchema } from "../types";
import { marshallCrawl, queueUrlToCrawl, unmarshallCrawl } from "../util";
import crypto from "crypto";

export const routes = (server: FastifyInstance, _: any, done: () => void ) => {
  server.post<{ Body: CrawlSubmission, Response: Crawl }>(
    "/crawl", 
    {
      schema: {
        body: crawlSubmissionSchema,
        response: {
          201: crawlSchema
        }
      }
    },
    async (req, reply) => {
      const { start_url } = req.body;
      const id = crypto.randomUUID();

      const crawl: Crawl = {
        id,
        start_url,
        status: "running",
        visited: 0,
        created: new Date().toISOString(),
        queue_url: "",
        dlq_url: ""
      };

      const dlqCmd = new CreateQueueCommand({
        QueueName: `${config.aws.sqs.queuePrefix}${id}-dlq`
      });

      let dlqRes;
      try {
        dlqRes = await sqs.send(dlqCmd)
      } catch (e: any) {
        e.response = "An error was encountered while creating the dead-letter queue for the crawl";
        throw e;
      }

      if (!dlqRes.QueueUrl) {
        throw new Error("An error was encountered while creating the dead-letter queue for the crawl");
      }

      crawl.dlq_url = dlqRes.QueueUrl;
      
      let dlqInfo;
      try {
        dlqInfo = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: dlqRes.QueueUrl,
            AttributeNames: ["QueueArn"]
          })
        );
      } catch (e) {
        console.log(e);
        throw new Error("An error was encountered while creating Queues for the crawl");
      }
      if (!dlqInfo.Attributes || !dlqInfo.Attributes.QueueArn) {
        console.log(dlqInfo);
        throw new Error("An error was encountered while creating Queues for the crawl");
      }



      const qCmd = new CreateQueueCommand({
        QueueName: `${config.aws.sqs.queuePrefix}${id}`,

        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqInfo.Attributes.QueueArn,
            maxReceiveCount: 2
          }),
          VisibilityTimeout: "20",
          ReceiveMessageWaitTimeSeconds: "1"
        }
      });

      let qRes;
      try {
        qRes = await sqs.send(qCmd);
      } catch (e) {
        console.log(e);
        throw new Error("An error was encountered while creating Queues for the crawl");
      }

      if (!qRes.QueueUrl) {
        console.log(qRes);
        throw new Error("An error was encountered while creating Queues for the crawl");
      }

      crawl.queue_url = qRes.QueueUrl;

      const putItemCmd = new PutItemCommand({
        TableName: config.aws.dynamodb.crawlTable,
        Item: marshallCrawl(crawl)
      });

      try {
        await dynamodb.send(putItemCmd);
      } catch (e: any) {
        e.response = "An error was encountered while creating the crawl";
        throw e;
      }

      try {
        await queueUrlToCrawl(id, start_url);
      } catch (e:any) {
        e.response = "An error was encountered while starting the crawl";
        throw e;
      }

      return reply.code(201).send(crawl);
    }
  );


  server.get<{ Params: { id: string }, Response: Crawl }>(
    "/crawl/:id",
    {
      schema: {
        params: {
          id: { type: "string" }
        },
        response: {
          200: crawlSchema
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;

      const getItemCmd = new GetItemCommand({
        TableName: config.aws.dynamodb.crawlTable,
        Key: {
          id: { S: id }
        }
      });

      let item;
      try {
        item = await dynamodb.send(getItemCmd);
      } catch (e) {
        throw new Error("An error was encountered while retrieving the crawl");
      }

      if (!item.Item) {
        throw new Error("An error was encountered while retrieving the crawl");
      }

      const crawl: Crawl = unmarshallCrawl(item.Item);

      return crawl;
    }
  );

  server.delete<{ Params: { id: string, hard: boolean }, Response: Crawl }>(
    "/crawl/:id",
    {
      schema: {
        params: {
          id: { type: "string" },
          hard: { 
            type: "boolean",
            default: false,
            description: "Whether to purge the queues"
          }
        },
        response: {
          200: crawlSchema
        }
      }
    },
    async (req, reply) => {
      const { id, hard } = req.params;

      // Try updating the status of the crawl to stopped
      const updateCmd = new UpdateItemCommand({
        TableName: config.aws.dynamodb.crawlTable,
        Key: {
          id: { S: id }
        },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": { S: "stopped" }
        },
        ReturnValues: "ALL_NEW"
      });

      let crawl: Crawl;
      try {
        const { Attributes } = await dynamodb.send(updateCmd);
        if (!Attributes) {
          throw new Error("An error was encountered while stopping the crawl");
        }
        crawl = unmarshallCrawl(Attributes);
      } catch (e: any) {
        // If the crawl doesn't exist, we return a 404
        if (e.name === "ResourceNotFoundException") {
          return reply.code(404).send();
        }

        throw new Error("An error was encountered while stopping the crawl");
      }

      if (hard) {
        // Purge the queues
        const purgeQCmd = new PurgeQueueCommand({
          QueueUrl: crawl.queue_url
        });
        const purgeDLQCmd = new PurgeQueueCommand({
          QueueUrl: crawl.dlq_url
        });

        try {
          await Promise.all([
            sqs.send(purgeQCmd),
            sqs.send(purgeDLQCmd)
          ]);
        } catch(e) {
          throw new Error("An error was encountered while stopping the crawl. The queues may not have been purged");
        }
      }

      return crawl;
    }
  );

  done();
}