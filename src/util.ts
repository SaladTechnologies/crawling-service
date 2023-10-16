import { sqs, dynamodb } from "./clients";
import { SendMessageCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import { GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import crypto from "crypto";
import config from "./config";
import { CrawlJob, Page, Crawl } from "./types";
import NodeCache from "node-cache";

const cachedQueueUrls: { [key: string]: string } = {};
const localVisitedCache = new Set<string>();

const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 0,
  useClones: false,
});

export const getCrawl = async (crawlId: string): Promise<Crawl | null> => {
  let crawl: Crawl | undefined = cache.get(crawlId!);
  if (!crawl) {
    const getCmd = new GetItemCommand({
      TableName: config.aws.dynamodb.crawlTable,
      Key: {
        id: { S: crawlId! }
      }
    });

    try {
      const { Item } = await dynamodb.send(getCmd);
      if (!Item) {
        return null;
      }
      crawl = unmarshallCrawl(Item);
      cache.set(crawlId, crawl);
    } catch (e) {
      throw new Error("An error was encountered while retrieving the crawl");
    }
  }
  return crawl;
};

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

export const getPageByUrl = async (url: string): Promise<Page | null> => {
  const queryCmd = new QueryCommand({
    TableName: config.aws.dynamodb.pagesTable,
    IndexName: "url-index",
    KeyConditionExpression: "#url = :url",
    ExpressionAttributeNames: {
      "#url": "url"
    },
    ExpressionAttributeValues: {
      ":url": { S: url }
    }
  });

  const queryRes = await dynamodb.send(queryCmd);
  if (!queryRes.Items || queryRes.Items.length === 0) {
    return null;
  }
  const page = queryRes.Items[0];
  return unmarshallPage(page) as Page;
};

// Function to remove subdomains and return the root domain
function getRootDomain(hostname: string) {
  const parts = hostname.split('.').reverse();
  if (parts.length >= 2) {
    return parts[1] + '.' + parts[0];
  }
  return hostname;
}

function hostsAreEqualIgnoringSubdomains(url1: string, url2: string) {
  // Parse the URLs
  const parsedUrl1 = new URL(url1);
  const parsedUrl2 = new URL(url2);

  // Extract the hostnames
  const hostname1 = parsedUrl1.hostname;
  const hostname2 = parsedUrl2.hostname;

  // Compare the root domains
  const rootDomain1 = getRootDomain(hostname1);
  const rootDomain2 = getRootDomain(hostname2);

  return rootDomain1 === rootDomain2;
}

export const queueUrlToCrawl = async (crawlId: string, url: string, depth: number = 0) => {
  if (localVisitedCache.has(url)) {
    return;
  }
  const visitedPage = await getPageByUrl(url);
  if (visitedPage) {
    localVisitedCache.add(url);
    return;
  }

  let crawl = await getCrawl(crawlId);
  if (!crawl) {
    throw new Error("Could not find crawl");
  }
  if (crawl.max_depth && depth > crawl.max_depth) {
    return;
  }

  // If crawl requires same_domain, check that the url is on the same domain
  if (crawl.same_domain && !hostsAreEqualIgnoringSubdomains(crawl.start_url, url)) {
    return;
  }

  try {
    const incrCmd = new UpdateItemCommand({
      TableName: config.aws.dynamodb.crawlTable,
      Key: {
        id: { S: crawlId }
      },
      UpdateExpression: "SET #visited = #visited + :incr",
      ConditionExpression: "attribute_not_exists(max_pages) OR #visited < #max_pages OR #max_pages = :neg_1",
      ExpressionAttributeNames: {
        "#visited": "visited",
        "#max_pages": "max_pages"
      },
      ExpressionAttributeValues: {
        ":incr": { N: "1" },
        ":neg_1": { N: "-1" }
      },
      ReturnValues: "ALL_NEW",

    });
    const { Attributes } = await dynamodb.send(incrCmd);
    crawl = unmarshallCrawl(Attributes);
    cache.set(crawlId, crawl);
  } catch (e: any) {
    // If the condition expression fails, we've hit the max pages
    if (e.name === "ConditionalCheckFailedException") {
      return;
    }

    e.response = "An error was encountered while incrementing the crawl"
    throw e;
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
    Item: marshallPage(page)
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

export const getRunningCrawls = async (): Promise<Crawl[]> => {
  const queryCmd = new QueryCommand({
    TableName: config.aws.dynamodb.crawlTable,
    IndexName: "status-index",
    KeyConditionExpression: "#status = :status",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: {
      ":status": { S: "running" }
    }
  });

  const queryRes = await dynamodb.send(queryCmd);
  if (!queryRes.Items) {
    return [];
  }

  return queryRes.Items.map(item => (unmarshallCrawl(item) as Crawl));
}

export function marshallPage(page: Page): any {
  const item: any = {
    id: { S: page.id },
    crawl_id: { S: page.crawl_id },
    url: { S: page.url },
    status: { S: page.status },
    depth: { N: page.depth?.toString() || "0" },
  };

  if (page.links?.length) {
    item.links = { SS: page.links };
  }

  if (page.content_key) {
    item.content_key = { S: page.content_key };
  }

  if (page.visited) {
    item.visited = { N: new Date(page.visited).getTime().toString() };
  }

  return item;

}

export function unmarshallPage(item: any): Page {
  return {
    id: item.id.S,
    crawl_id: item.crawl_id.S,
    url: item.url.S,
    links: item.links?.SS || [],
    status: item.status.S,
    depth: parseInt(item.depth.N || "0"),
    content_key: item.content_key?.S,
    visited: item.visited.N ? new Date(parseInt(item.visited.N)).toISOString() : undefined
  };
}

export function marshallCrawl(crawl: Crawl): any {
  return {
    id: { S: crawl.id },
    start_url: { S: crawl.start_url },
    status: { S: crawl.status },
    queue_url: { S: crawl.queue_url },
    dlq_url: { S: crawl.dlq_url },
    visited: { N: crawl.visited.toString() },
    created: { S: crawl.created },
    max_depth: { N: crawl.max_depth?.toString() || "10" },
    max_pages: { N: crawl.max_pages?.toString() || "1000" },
    same_domain: { BOOL: crawl.same_domain || true }
  };
}

export function unmarshallCrawl(item: any): Crawl {
  return {
    id: item.id.S,
    start_url: item.start_url.S,
    status: item.status.S,
    queue_url: item.queue_url.S,
    dlq_url: item.dlq_url.S,
    visited: parseInt(item.visited.N || "0"),
    created: item.created.S,
    max_depth: parseInt(item.max_depth.N || "0"),
    max_pages: parseInt(item.max_pages.N || "0"),
    same_domain: item.same_domain.BOOL
  };
}