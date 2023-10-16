# crawling-service
A simple web service for managing web crawls

## Docs

Docs are available at `/docs` when the service is running.

## Docker

```
saladtechnologies/crawling-service:latest
```

## Provisioning AWS Resources

You will need [OpenTofu](https://opentofu.org/) or terraform for this.
`resources.tf` expects an aws profile named "tofu". You will need to rename your s3 bucket in `resources.tf` as well.

```bash
tofu init
tofu apply
```

This also creates an IAM user with the appropriate permissions, and exports the access key and secret key. To copy them to the clipboard, run:

**Access Key Id**
```bash
tofu output crawler-service-access-key | xclip -selection clipboard
```

**Secret Access Key**
```bash
tofu output crawler-service-secret-key | xclip -selection clipboard
```


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

OR

```bash
docker compose up
```