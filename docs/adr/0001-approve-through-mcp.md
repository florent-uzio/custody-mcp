# Intents can be approved and rejected through the MCP

Unlike a typical "LLM proposes, human approves elsewhere" design, this server lets the AI client Approve and Reject Intents as the Environment's user, so a whole workflow (propose → approve → follow up) can run from one conversation. Because an LLM mistake here can move real assets, approval is gated three ways: the Environment's Access level must be `approve` (the default is `read`), every write call must name its Environment explicitly (no fallback to the default), and Approve/Reject ask the human for confirmation through MCP elicitation, falling back to an instruction-level "summarise and wait for yes" rule only when the client cannot elicit.

On the 2026-07-28 MCP revision (the only one `@mastra/mcp` 2.x serves), the server cannot send an elicitation request of its own: the tool suspends, the call ends as `input_required` with a confirmation form, and the tool runs again once the human accepts. A decline or cancel ends the call without running it again, so nothing reaches Custody. Suspending for a client that has not declared elicitation is a protocol error, so the tool reads the capabilities the client declares on the request and, without elicitation, acts at once and says in its result that no in-client confirmation was shown.

## Considered Options

- **Propose only, approve in the Custody UI** — safest, but breaks multi-step workflows the team runs on test instances.
- **Instruction-only confirmation** (as in xrpl-mastra-ai) — relies entirely on the model obeying a prompt; rejected as the primary gate for approvals.
- **Refuse to approve when the client cannot elicit** — stricter, but would make Approve unusable from clients that do not support elicitation yet; rejected in favour of the instruction-level fallback plus a result that says no confirmation was shown.
