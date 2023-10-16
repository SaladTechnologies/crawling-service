# crawling-service
A simple web service for managing web crawls

## Under Construction
This service is not ready to use yet.

## Build

```bash
docker buildx build \
-t saladtechnologies/crawling-service:latest \
--platform linux/amd64 \
--output type=docker \
--provenance=false \
.
```

## Run

```bash
docker run --rm -it \
-p 3000:3000 \
-e PORT=3000 \
-e HOST="0.0.0.0" \
-e AWS_DEFAULT_REGION=us-east-2 \
-e AWS_PROFILE=crawler-service \
-e S3_BUCKET_NAME=salad-crawler-page-data \
-e CRAWL_TABLE_NAME=crawls \
-e PAGES_TABLE_NAME=pages \
-v ~/.aws:/root/.aws \
saladtechnologies/crawling-service:latest
```