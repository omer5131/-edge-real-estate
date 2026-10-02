# DeepSeek data agents

The Data page includes **Ask the SQL agent**, which translates a natural-language question using the live catalogue and semantic definitions. Every referenced table must first be inspected. Generated SQL is parsed and validated, shown for review, and is not executed until the user runs it in the SQL editor.

**Ask Edge** uses a separate DeepSeek assistant whose only data-query tool is the specialist SQL agent. The tool translates and validates SQL, then retrieves evidence through the existing PostgreSQL read-only executor. Answers include expandable SQL evidence. Unsupported questions ask for clarification rather than inventing datasets.

## Activation

Set `DEEPSEEK_API_KEY` as a **server-only, sensitive production environment variable** in the existing Edge Vercel project, then redeploy. Do not commit the value or use a VITE/public-prefixed variable. `DEEPSEEK_MODEL` optionally overrides the documented default `deepseek-flash`. The provided chat key must not be copied to source files, prompts, client storage, or logs.

Endpoints: `GET /api/ask?mode=sql-agent` or `edge-agent` reports activation. POST accepts `question`; the assistant also accepts up to eight user/assistant history messages. Translation responds with SQL, explanation, assumptions and optional clarification. Model requests use DeepSeek's OpenAI-compatible API directly, not a gateway.

## Safety and usage

- Questions and dataset metadata are sent to DeepSeek; the assistant also sends bounded query result samples. Both interfaces disclose this before submission.
- No agent may write data. SQL validation, allowlisted datasets/functions/casts, an eight-second database timeout and a 200-row result cap are shared with the SQL explorer.
- Each SQL agent can use five model steps. The assistant can use five steps and at most three SQL-agent tool requests. A request has a 110-second deadline; inference retries are disabled.
- Durable daily budgets allow at most 50 inference requests globally and 10 per hashed client IP. The budget table stores dates, hashed buckets and request counts—not prompts or credentials. Failed/limited requests can consume global slots conservatively. This is a usage safeguard, not authenticated access; configure provider-side spending limits too.
- Assistant samples are capped at 40 rows and approximately 18,000 characters. Truncation is explicit. Aggregation should happen in SQL; sample rows must not be treated as complete populations.
- Dataset rows and metadata are treated as untrusted evidence. Empty datasets mean missing collected evidence, not no market activity.

Verification: server/frontend type checks, production frontend build, existing SQL-validator tests, and mocked-provider tests in `tests/deepseek-agents.test.mjs`. Live activation/provider credits cannot be verified until the environment variable is configured.
