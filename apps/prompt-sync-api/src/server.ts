import Fastify from "fastify";
import type { ApiAcceptedResponse, DevelopmentEpisodeDraft } from "@rapid-prompt/prompt-builder-contracts";

const server = Fastify({
  logger: true,
});

server.get("/healthz", async () => {
  return {
    ok: true,
    service: "prompt-sync-api",
  };
});

server.post<{ Body: DevelopmentEpisodeDraft }>("/v1/episodes", async (request, reply) => {
  request.log.info(
    {
      workspaceId: request.body.workspaceId,
      title: request.body.title,
    },
    "episode accepted",
  );

  const response: ApiAcceptedResponse = {
    status: "accepted",
  };

  return reply.code(202).send(response);
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

await server.listen({ port, host });
