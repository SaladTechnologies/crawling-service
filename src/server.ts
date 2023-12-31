import { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import config from "./config";
import { routes as crawlRoutes } from "./routes/crawl";
import { routes as pageRoutes } from "./routes/page";
import { routes as jobRoutes } from "./routes/job";

export const build = async (opts: FastifyServerOptions = {}): Promise<FastifyInstance> => {
  const server = Fastify(opts).withTypeProvider<JsonSchemaToTsProvider>();

  await server.register(require("@fastify/cors"))

  await server.register(require("@fastify/swagger"), {
    routePrefix: "/docs",
    swagger: {
      info: {
        title: "Crawler API",
        description: "Crawler API",
        version: config.server.version,
      },
      host: config.server.publicUrl,
      schemes: ["http", "https"],
      consumes: ["application/json"],
      produces: ["application/json"],
    },
    exposeRoute: true,
  });
  await server.register(require("@fastify/swagger-ui"), {
    routePrefix: "/docs",
    exposeRoute: true,
  });

  server.get(
    "/hc",
    {
      schema: {
        description: "Health check",
        response: {
          200: {
            type: "string",
          },
        },
      },
    },
    async () => {
      return "OK";
    }
  );

  server.setErrorHandler((error: any, request, reply) => {
    const { message, statusCode, validation, validationContext, response } = error;
    if (statusCode === 413) {
      reply.status(413).send({
        error: "File too large",
      });
      return;
    }
    if (validation) {
      reply.status(400).send({
        error: message,
      });
    } else {
      // This is the only place we do something different from prod and dev
      if (process.env.NODE_ENV === "production") {
        server.log.error(error);
      } else {
        // Stack traces are easy to read this way than with single-line json objects
        console.error(error);
      }
      reply.status(statusCode || 500).send({
        error: response,
      });
    }
  });

  server.register(jobRoutes);
  server.register(crawlRoutes);
  server.register(pageRoutes);
  
  await server.ready();
  return server;
};

export const start = async (server: FastifyInstance) => {
  try {
    await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};