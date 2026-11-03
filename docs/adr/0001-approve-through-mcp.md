# Intents can be approved and rejected through the MCP

Unlike a typical "LLM proposes, human approves elsewhere" design, this server lets the AI client Approve and Reject Intents as the Environment's user, so a whole workflow (propose → approve → follow up) can run from one conversation. Because an LLM mistake here can move real assets, approval is gated three ways: the Environment's Access level must be `approve` (the default is `read`), every write call must name its Environment explicitly (no fallback to the default), and Approve/Reject ask the human for confirmation through MCP elicitation, falling back to an instruction-level "summarise and wait for yes" rule only when the client cannot elicit.

## Considered Options

- **Propose only, approve in the Custody UI** — safest, but breaks multi-step workflows the team runs on test instances.
- **Instruction-only confirmation** (as in xrpl-mastra-ai) — relies entirely on the model obeying a prompt; rejected as the primary gate for approvals.
