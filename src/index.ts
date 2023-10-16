import { build, start } from "./server";

build({ logger: true, bodyLimit: 100 * 1024 * 1024 })
  .then((server) => start(server))
  .catch((e: any) => {
    console.error(e);
    process.exit(1);
  });