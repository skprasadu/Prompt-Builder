# LLM JSON Config

Rapid Prompt now uses a JSON config file instead of `.env.local`.

## File

Development config lives at:

```txt
apps/desktop/llm.config.json
```

A safe example is kept at:

```txt
apps/desktop/llm.config.example.json
```

Packaged apps load:

```txt
<resources>/llm.config.json
```

`electron-builder.yml` includes this file as an `extraResource`.

## Override locations

The loader checks in this order:

```txt
RAPID_PROMPT_LLM_CONFIG
~/.rapid_prompt/llm.config.json
process.resourcesPath/llm.config.json
apps/desktop/llm.config.json
```

## OpenAI model

```json
{
  "id": "openai-gpt-5.4-mini",
  "provider": "openai",
  "endpoint": "https://api.openai.com/v1",
  "apiKey": "...",
  "model": "gpt-5.4-mini"
}
```

## Azure OpenAI model

```json
{
  "id": "azure-gpt-5-mini",
  "provider": "azure-openai",
  "endpoint": "https://YOUR_RESOURCE.cognitiveservices.azure.com",
  "apiKey": "...",
  "deployment": "gpt-5-mini",
  "apiVersion": "2025-04-01-preview"
}
```

## Important

Bundling a key inside a `.dmg`, `.app`, `.msi`, or installer makes that key available to anyone who can inspect the installed app resources. This is acceptable only for controlled internal distribution. For external distribution, use per-user configuration, Keychain/safe storage, or a backend proxy.
