import { FastifyInstance } from "fastify";
import { sqs, dynamodb } from "../clients";
import { PutItemCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { CreateQueueCommand, SendMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import config from "../config";
import { Crawl, crawlSchema, CrawlSubmission, crawlSubmissionSchema } from "../types";
import crypto from "crypto";

export const routes = (server: FastifyInstance, done: () => void ) => {
  server.post<{ Body: CrawlSubmission }>(
    "/crawl", 
    {
      schema: {
        body: crawlSubmissionSchema
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
      } catch (e) {
        throw new Error("An error was encountered while creating the dead-letter queue for the crawl");
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
        throw new Error("An error was encountered while creating Queues for the crawl");
      }
      if (!dlqInfo.Attributes || !dlqInfo.Attributes.QueueArn) {
        throw new Error("An error was encountered while creating Queues for the crawl");
      }



      const qCmd = new CreateQueueCommand({
        QueueName: `${config.aws.sqs.queuePrefix}${id}`,

        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqInfo.Attributes.QueueArn,
            maxReceiveCount: 2
          })
        }
      });

      let qRes;
      try {
        qRes = await sqs.send(qCmd);
      } catch (e) {
        throw new Error("An error was encountered while creating Queues for the crawl");
      }

      if (!qRes.QueueUrl) {
        throw new Error("An error was encountered while creating Queues for the crawl");
      }

      crawl.queue_url = qRes.QueueUrl;

      const putItemCmd = new PutItemCommand({
        TableName: config.aws.dynamodb.crawlTable,
        Item: {
          id: { S: id },
          start_url: { S: start_url },
          status: { S: crawl.status },
          visited: { N: crawl.visited.toString() },
          created: { S: crawl.created },
          queue_url: { S: crawl.queue_url },
          dlq_url: { S: crawl.dlq_url }
        }
      });

      try {
        await dynamodb.send(putItemCmd);
      } catch (e) {
        throw new Error("An error was encountered while creating the crawl");
      }

      const msgCmd = new SendMessageCommand({
        QueueUrl: crawl.queue_url,
        MessageBody: JSON.stringify({
          url: start_url,
          crawl_id: id
        })
      });

      try {
        await sqs.send(msgCmd);
      } catch (e) {
        throw new Error("An error was encountered while starting the crawl");
      }

      return reply.code(201).send(crawl);
    }
  );


  server.get<{ Params: { id: string } }>(
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

      const crawl: Crawl = {
        id: item.Item.id.S || "",
        start_url: item.Item.start_url.S || "",
        status: item.Item.status.S as "running" | "completed" | "stopped",
        visited: parseInt(item.Item.visited.N || "0"),
        created: item.Item.created.S || "",
        queue_url: item.Item.queue_url.S || "",
        dlq_url: item.Item.dlq_url.S || ""
      };

      return crawl;
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/crawl/:id",
    {
      schema: {
        params: {
          id: { type: "string" }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params;

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

      let crawl: Crawl | undefined;
      try {
        const { Attributes } = await dynamodb.send(updateCmd);
        if (!Attributes) {
          throw new Error("An error was encountered while stopping the crawl");
        }
        crawl = {
          id: Attributes.id.S || "",
          start_url: Attributes.start_url.S || "",
          status: Attributes.status.S as "running" | "completed" | "stopped",
          visited: parseInt(Attributes.visited.N || "0"),
          created: Attributes.created.S || "",
          queue_url: Attributes.queue_url.S || "",
          dlq_url: Attributes.dlq_url.S || ""
        }
      } catch (e: any) {
        // If the crawl doesn't exist, we return a 404
        if (e.name === "ResourceNotFoundException") {
          return reply.code(404).send();
        }

        throw new Error("An error was encountered while stopping the crawl");
      }

      return crawl;
    }
  );

  done();
}