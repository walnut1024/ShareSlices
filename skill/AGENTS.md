# Official Skill engineering guidance

Inherits [repository-wide guidance](../AGENTS.md) and owns rules specific to `skill/**`.

## Boundary

- Keep the official ShareSlices Skill as a thin intent adapter over the installed `shareslices` CLI.
- The Skill may discover user-authorized local inputs, select the matching CLI operation, invoke it, and summarize the durable result.
- Invoke the CLI instead of making hand-written REST calls. A separately requested external API integration is a different surface and follows [PRODUCT.md](../PRODUCT.md) plus the checked OpenAPI contract.
- The official Skill does not call databases or object storage directly.
- Do not duplicate packaging, retries, authentication mechanics, validation, lifecycle rules, authorization policy, or storage behavior from the CLI or Server.
- Do not silently widen the user's requested operation.

## CLI use

- Treat installed `shareslices ... --help` output as the current command contract.
- Treat a nonzero CLI exit as failure. Do not invent a Share link, Publication state, or other durable result.
- If an outcome cannot be expressed through the installed CLI, report the CLI boundary gap. Do not add an alternate execution path to the official Skill.
