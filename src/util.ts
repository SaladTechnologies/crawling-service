import { sqs, dynamodb } from "./clients";
import { SendMessageCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";
import config from "./config";
import { CrawlJob, Page } from "./types";

const cachedQueueUrls: { [key: string]: string } = {};
const localVisitedCache = new Set<string>();


export const getQueueUrl = async (crawlId: string) => {
  if (cachedQueueUrls[crawlId]) {
    return cachedQueueUrls[crawlId];
  }

  const queueName = `${config.aws.sqs.queuePrefix}${crawlId}`;
  const queueUrl = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (!queueUrl.QueueUrl) {
    throw new Error("Could not find queue url");
  }
  cachedQueueUrls[crawlId] = queueUrl.QueueUrl;
  return queueUrl.QueueUrl;
}

export const getPageByUrl = async (url: string) : Promise<Page | null> => {
  const queryCmd = new QueryCommand({
    TableName: config.aws.dynamodb.pagesTable,
    IndexName: "url-index",
    KeyConditionExpression: "url = :url",
    ExpressionAttributeValues: {
      ":url": { S: url }
    }
  });

  const queryRes = await dynamodb.send(queryCmd);
  if (!queryRes.Items || queryRes.Items.length === 0) {
    return null;
  }
  const page = queryRes.Items[0];
  return {
    id: page.id.S,
    crawl_id: page.crawl_id.S,
    url: page.url.S,
    links: page.links.SS,
    status: page.status.S,
    content_key: page.content_key.S,
    visited: page.visited.N ? new Date(parseInt(page.visited.N)).toISOString() : undefined
  } as Page;
};

export const queueUrlToCrawl = async (crawlId: string, url: string) => {
  if (localVisitedCache.has(url)) {
    return;
  }
  const visitedPage = await getPageByUrl(url);
  if (visitedPage) {
    localVisitedCache.add(url);
    return;
  }
  localVisitedCache.add(url);

  const queueUrl = await getQueueUrl(crawlId);
  
  const pageId = crypto.randomUUID();
  
  const page: Page = {
    id: pageId,
    crawl_id: crawlId,
    url,
    links: [],
    status: "queued"
  };

  const putPageCmd = new PutItemCommand({
    TableName: config.aws.dynamodb.pagesTable,
    Item: {
      id: { S: pageId },
      crawl_id: { S: crawlId },
      url: { S: url },
      links: { SS: page.links },
      status: { S: page.status }
    }
  });

  const crawlJob: CrawlJob = {
    page_id: pageId,
    crawl_id: crawlId,
    url
  };

  const sendMessageCmd = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(crawlJob)
  });

  await Promise.all([
    dynamodb.send(putPageCmd),
    sqs.send(sendMessageCmd)
  ]);
  
  return crawlJob;
}