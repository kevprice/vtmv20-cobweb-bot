import { createServer, Server } from "node:http";

export const startHealthServer = (port: number): Server => {
  const server = createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
};
