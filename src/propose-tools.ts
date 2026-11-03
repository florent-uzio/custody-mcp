import {
  CustodyError,
  type Core_IntentDryRunRequest,
  type Core_ProposeIntentBody,
  type WaitForExecutionResult,
} from '@florent-uzio/custody'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CustodyClient } from './custody'
import { domainIdFor, domainInput, type DefineCustodyTool } from './custody-tool'
import type { Environment } from './environments'

const intentInput = {
  ...domainInput,
  // Loose on purpose: the Dry run is what checks a payload, with Custody's own reasons.
  payload: z
    .looseObject({ type: z.string().startsWith('v0_') })
    .describe('The `v0_*` Intent payload, e.g. { "type": "v0_LockAccount", "accountId": "…" }.'),
  description: z.string().optional().describe('A human-readable description of the Intent, shown to approvers.'),
}

// The same lifetime custody.js gives the Intents it proposes.
const INTENT_LIFETIME_MS = 24 * 60 * 60 * 1000

type IntentArgs = {
  input: z.infer<z.ZodObject<typeof intentInput>>
  custody: CustodyClient
  environment: Environment
}

/** The request around a payload: the same one is dry-run and then proposed, so approvers get what was checked. */
const buildRequest = async (args: IntentArgs) => {
  const domainId = await domainIdFor(args)
  const { domains } = await args.custody.users.me()
  const userId = domains.find(domain => domain.id === domainId)?.userReference.id
  if (userId === undefined) {
    throw new Error(`The user of Environment "${args.environment.name}" does not belong to domain ${domainId}.`)
  }
  const { payload, description } = args.input
  const request: Core_IntentDryRunRequest = {
    author: { domainId, id: userId },
    targetDomainId: domainId,
    id: randomUUID(),
    expiryAt: new Date(Date.now() + INTENT_LIFETIME_MS).toISOString(),
    // The Dry run is what validates the payload against Custody's schema.
    payload: payload as unknown as Core_IntentDryRunRequest['payload'],
    customProperties: {},
    ...(description === undefined ? {} : { description }),
  }
  return { domainId, request }
}

const dryRun = async (custody: CustodyClient, request: Core_IntentDryRunRequest) => {
  const { success, errors = [] } = await custody.intents.dryRun(request)
  return { success, errors }
}

const POLL_INTERVAL_MS = 3000

/** Says in plain terms where a wait left the Intent, so a slow approval never reads as a failure. */
const waitMessage = (intentId: string, seconds: number, result: WaitForExecutionResult) => {
  if (result.isSuccess) {
    return `Intent ${intentId} is Executed. Executed means Custody accepted the order, not that it settled on the ledger: follow it with listTransactionOrders and getTransaction.`
  }
  if (!result.isTerminal) {
    const where = result.status === 'Open' ? 'still awaiting approval' : `still ${result.status}`
    return `Intent ${intentId} is ${where} after ${seconds}s. This is not an error: call waitForIntent again later, or check it with getIntent.`
  }
  const { error } = result.intent.data.state
  return error === undefined
    ? `Intent ${intentId} did not execute: it is ${result.status}.`
    : `Intent ${intentId} did not execute: it is ${result.status} (${error.code}): ${error.message}`
}

/** The tools that Propose Intents, and the Dry run and wait that go with them. */
export const createProposeTools = (defineCustodyTool: DefineCustodyTool) => ({
  waitForIntent: defineCustodyTool({
    id: 'waitForIntent',
    description:
      'Wait a bounded time (default 30 seconds) for an Intent to finish: Executed, Failed, Rejected or Expired. If approvers have not acted yet, it says the Intent is still awaiting approval; that is not an error. Executed means Custody accepted the order, not that it settled on the ledger.',
    input: {
      ...domainInput,
      intentId: z.string().describe('Id of the Intent (from proposeIntent or listIntents).'),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe('How long to wait, in seconds (default 30, at most 55 to stay under client timeouts).'),
    },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { intentId, timeoutSeconds } = args.input
      let result: WaitForExecutionResult
      try {
        result = await args.custody.intents.getAndWait(
          { domainId, intentId },
          { maxRetries: Math.ceil((timeoutSeconds * 1000) / POLL_INTERVAL_MS), intervalMs: POLL_INTERVAL_MS },
        )
      } catch (error) {
        // custody.js gives up with a 404 when the Intent never showed up, e.g. right after a Propose.
        if (!(error instanceof CustodyError && error.statusCode === 404)) {
          throw error
        }
        return {
          domainId,
          intentId,
          done: false,
          message: `Intent ${intentId} is not visible in Custody yet after ${timeoutSeconds}s. Check the id, or call waitForIntent again later.`,
        }
      }
      return {
        domainId,
        intentId,
        status: result.status,
        done: result.isTerminal,
        message: waitMessage(intentId, timeoutSeconds, result),
      }
    },
  }),

  // A read: the Dry run is unsigned and changes nothing in Custody.
  dryRunIntent: defineCustodyTool({
    id: 'dryRunIntent',
    description:
      'Run a Dry run of an Intent with a raw `v0_*` payload: Custody says whether it would be accepted and why not, without proposing anything.',
    input: intentInput,
    run: async args => {
      const { domainId, request } = await buildRequest(args)
      return { domainId, ...(await dryRun(args.custody, request)) }
    },
  }),

  proposeIntent: defineCustodyTool({
    id: 'proposeIntent',
    description:
      'Propose an Intent with a raw `v0_*` payload, for Intent types with no dedicated tool. Runs a Dry run first and proposes nothing if it fails. Returns the Intent id and status at once, without waiting for approvals (see waitForIntent).',
    access: 'propose',
    input: intentInput,
    run: async args => {
      const { custody } = args
      const { domainId, request } = await buildRequest(args)
      const result = await dryRun(custody, request)
      if (!result.success) {
        const reasons = result.errors.length > 0 ? result.errors.join('; ') : 'Custody gave no reason'
        throw new Error(`The Dry run failed, so nothing was proposed: ${reasons}`)
      }
      // custody.js types the proposed payload apart from the dry-run one; both are the raw payload given.
      await custody.intents.propose({ request: { ...request, type: 'Propose' } as Core_ProposeIntentBody['request'] })
      const proposed = { domainId, intentId: request.id }
      // From here the Intent exists: an error would make the model propose it again.
      try {
        const intent = await custody.intents.get(proposed)
        return { ...proposed, status: intent.data.state.status }
      } catch {
        return {
          ...proposed,
          note: 'Custody accepted the Propose but its status could not be read yet. Use getIntent or waitForIntent; do not propose it again.',
        }
      }
    },
  }),
})
