import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import type { CustodyClient } from '../custody'
import { domainIdFor, domainInput, type DefineCustodyTool } from './define'
import type { Environment } from '../environments'

// The capabilities a 2026-07-28 client declares on each request, under this `_meta` key.
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'

/** Whether the client can show a form: suspending for a client that cannot is a protocol error. */
const canElicit = (context: ToolExecutionContext) => {
  // The SDK types the envelope as `{}`; this is the part of it read here.
  const envelope = context.mcp?.extra.mcpReq.envelope as
    { [CLIENT_CAPABILITIES_META_KEY]?: { elicitation?: { form?: object; url?: object } } } | undefined
  const elicitation = envelope?.[CLIENT_CAPABILITIES_META_KEY]?.elicitation
  // A bare `elicitation: {}` means form support; declaring only `url` does not.
  return elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined)
}

// The client cannot elicit, so the server instructions' "summarize and wait for yes" rule was the only gate.
const NO_CONFIRMATION_SHOWN =
  'No in-client confirmation was shown: this client cannot display one, so the decision rested on the yes you got in the conversation.'

type Intent = Awaited<ReturnType<CustodyClient['intents']['get']>>

/** The Intent as the human sees it before deciding: `question` says what they are agreeing to. */
const summarize = (question: string, intent: Intent) => {
  const { details } = intent.data
  return [
    question,
    `Type: ${details.payload.type}`,
    `Description: ${details.metadata.description ?? '(none)'}`,
    `Proposed by ${'id' in details.author ? `user ${details.author.id} (domain ${details.author.domainId})` : details.author.subject}, expires ${details.expiryAt}`,
    `Payload: ${JSON.stringify(details.payload)}`,
  ].join('\n')
}

/** The Environment's user id in a domain: the author of its decisions. */
const userIn = async (custody: CustodyClient, environment: Environment, domainId: string) => {
  const { domains } = await custody.users.me()
  const userId = domains.find(domain => domain.id === domainId)?.userReference.id
  if (userId === undefined) {
    throw new Error(`The user of Environment "${environment.name}" does not belong to domain ${domainId}.`)
  }
  return { domainId, id: userId }
}

const intentIdInput = z.string().describe('Id of the Intent (see listPendingApprovals).')

type DecisionArgs = {
  input: { domainId?: string; intentId: string }
  custody: CustodyClient
  environment: Environment
  context: ToolExecutionContext
}

/**
 * Fetches the Intent, asks the human to confirm `verb` on it, and only then has `decide` act. Without
 * elicitation in the client it acts at once, relying on the instructions' rule, and says so in the result.
 */
const decideConfirmed = async (
  { input, custody, environment, context }: DecisionArgs,
  verb: string,
  decide: (decision: {
    author: { domainId: string; id: string }
    targetDomainId: string
    intentId: string
    proposalSignature: string
  }) => Promise<unknown>,
) => {
  const domainId = await domainIdFor({ input, custody, environment })
  const intent = await custody.intents.get({ domainId, intentId: input.intentId })
  const confirmed = context.resumeData !== undefined
  // A decline or cancel never comes back here: the server ends the call without running the tool again.
  if (!confirmed && canElicit(context)) {
    const question = `${verb} Intent ${input.intentId} in Environment "${environment.name}" (domain ${domainId})?`
    await context.suspend?.({ message: summarize(question, intent) })
    return {}
  }
  await decide({
    author: await userIn(custody, environment, domainId),
    targetDomainId: domainId,
    intentId: input.intentId,
    proposalSignature: intent.data.details.proposalSignature,
  })
  return { domainId, intentId: input.intentId, ...(confirmed ? {} : { note: NO_CONFIRMATION_SHOWN }) }
}

/** The tools that Approve or Reject an Intent as the Environment's user, after the human confirms (ADR-0001). */
export const createApproveTools = (defineCustodyTool: DefineCustodyTool) => ({
  approveIntent: defineCustodyTool({
    id: 'approveIntent',
    description: 'Approve a pending Intent as the Environment user, after the human confirms.',
    access: 'approve',
    input: { ...domainInput, intentId: intentIdInput },
    // Empty: the message carries the summary, and Accept is the human's yes.
    resumeSchema: z.object({}),
    run: args =>
      decideConfirmed(args, 'Approve', decision =>
        args.custody.intents.approve({ request: { ...decision, type: 'Approve' } }),
      ),
  }),

  rejectIntent: defineCustodyTool({
    id: 'rejectIntent',
    description: 'Reject a pending Intent as the Environment user, with a reason, after the human confirms.',
    access: 'approve',
    input: {
      ...domainInput,
      intentId: intentIdInput,
      reason: z.string().min(1).describe('Why the Intent is rejected, recorded in Custody.'),
    },
    resumeSchema: z.object({}),
    run: args =>
      decideConfirmed(args, `Reject (reason: ${args.input.reason})`, decision =>
        args.custody.intents.reject({ request: { ...decision, rejectReason: args.input.reason, type: 'Reject' } }),
      ),
  }),
})
