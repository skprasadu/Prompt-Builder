# Azure Deployment Notes

`apps/prompt-sync-api` is structured as a containerized Fastify service. It is a good fit for Azure Container Apps or another container runtime.

The first API is intentionally small:

- `GET /healthz`
- `POST /v1/episodes`

Add persistence, authentication, object storage, and background summarization after the desktop episode-capture model is stable.
