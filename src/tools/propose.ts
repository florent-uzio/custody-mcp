import {
  CustodyError,
  type Core_IntentDryRunRequest,
  type Core_ProposeIntentBody,
  type WaitForExecutionResult,
} from '@florent-uzio/custody'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CustodyClient } from '../custody'
import type { DefineCustodyTool } from './define'
import type { Environment } from '../environments'
import { xrplOperation } from './xrpl-operation'

const intentInput = {
  // Loose on purpose: the Dry run is what checks a payload, with Custody's own reasons.
  payload: z
    .looseObject({ type: z.string().startsWith('v0_') })
    .describe('The `v0_*` Intent payload, e.g. { "type": "v0_LockAccount", "accountId": "…" }.'),
  description: z.string().optional().describe('A human-readable description of the Intent, shown to approvers.'),
}

const xrplIntentInput = {
  account: z.string().describe('XRPL address of the Custody account the transaction is sent from.'),
  ledgerId: z.string().optional().describe('Id of the ledger, when the address is on several.'),
  operation: xrplOperation,
  description: intentInput.description,
}

// The Dry run is what validates a raw payload against Custody's schema.
const rawPayload = (input: { payload: object }) => input.payload as unknown as IntentPayload

// The same lifetime custody.js gives the Intents it proposes.
const INTENT_LIFETIME_MS = 24 * 60 * 60 * 1000

type IntentArgs = {
  input: z.infer<z.ZodObject<typeof intentInput>>
  custody: CustodyClient
  environment: Environment
}

type IntentPayload = Core_IntentDryRunRequest['payload']

/** The request around a payload: the same one is dry-run and then proposed, so approvers get what was checked. */
const buildRequest = async (
  { custody, environment, input }: Pick<IntentArgs, 'custody' | 'environment'> & { input: { description?: string } },
  domainId: string,
  payload: IntentPayload,
) => {
  const { domains } = await custody.users.me()
  const userId = domains.find(domain => domain.id === domainId)?.userReference.id
  if (userId === undefined) {
    throw new Error(`The user of Environment "${environment.name}" does not belong to domain ${domainId}.`)
  }
  const { description } = input
  const request: Core_IntentDryRunRequest = {
    author: { domainId, id: userId },
    targetDomainId: domainId,
    id: randomUUID(),
    expiryAt: new Date(Date.now() + INTENT_LIFETIME_MS).toISOString(),
    payload,
    customProperties: {},
    ...(description === undefined ? {} : { description }),
  }
  return request
}

const dryRun = async (custody: CustodyClient, request: Core_IntentDryRunRequest) => {
  const { success, errors = [] } = await custody.intents.dryRun(request)
  return { success, errors }
}

/** Dry-runs the request and proposes it unchanged only if the Dry run passed. */
const proposeChecked = async (custody: CustodyClient, domainId: string, request: Core_IntentDryRunRequest) => {
  const result = await dryRun(custody, request)
  if (!result.success) {
    const reasons = result.errors.length > 0 ? result.errors.join('; ') : 'Custody gave no reason'
    throw new Error(`The Dry run failed, so nothing was proposed: ${reasons}`)
  }
  // custody.js types the proposed payload apart from the dry-run one; both are the raw payload given.
  await custody.intents.propose({ request: { ...request, type: 'Propose' } as Core_ProposeIntentBody['request'] })
  return withStatus(custody, { domainId, intentId: request.id })
}

/** Adds the status of an Intent just proposed. From here the Intent exists: an error would make the model propose it again. */
const withStatus = async (custody: CustodyClient, proposed: { domainId: string; intentId: string }) => {
  try {
    const intent = await custody.intents.get(proposed)
    return { ...proposed, status: intent.data.state.status }
  } catch {
    return {
      ...proposed,
      note: 'Custody accepted the Propose but its status could not be read yet. Use getIntent or waitForIntent; do not propose it again.',
    }
  }
}

const POLL_INTERVAL_MS = 3000

/** Says in plain terms where a wait left the Intent, so a slow approval never reads as a failure. */
const waitMessage = (intentId: string, seconds: number, result: WaitForExecutionResult) => {
  if (result.isSuccess) {
    return `Intent ${intentId} is Executed. Executed means Custody accepted the order, not that it settled on the ledger: follow it with listTransactionOrders, listTransactions and getTransaction.`
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
    domain: true,
    input: {
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
      const { domainId } = args
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
          intentId,
          done: false,
          message: `Intent ${intentId} is not visible in Custody yet after ${timeoutSeconds}s. Check the id, or call waitForIntent again later.`,
        }
      }
      return {
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
    domain: true,
    input: intentInput,
    run: async args => {
      const { domainId } = args
      const request = await buildRequest(args, domainId, rawPayload(args.input))
      return dryRun(args.custody, request)
    },
  }),

  // A read: the Dry run is unsigned and changes nothing in Custody.
  dryRunXrplIntent: defineCustodyTool({
    id: 'dryRunXrplIntent',
    description:
      'Run a Dry run of an XRPL transaction from a Custody account, with the same input as proposeXrplIntent: Custody says whether it would be accepted and why not, and estimates the fee, without proposing anything.',
    domain: true,
    input: xrplIntentInput,
    run: async args => {
      const { custody, input, domainId } = args
      const {
        success,
        errors = [],
        estimate,
      } = await custody.xrpl.dryRunIntent(
        { Account: input.account, operation: input.operation },
        { domainId, ledgerId: input.ledgerId, description: input.description },
      )
      return { success, errors, estimate }
    },
  }),

  proposeXrplIntent: defineCustodyTool({
    id: 'proposeXrplIntent',
    description:
      'Propose an XRPL transaction from a Custody account. Runs a Dry run first and proposes nothing if it fails. Returns the Intent id, the payload id (the transaction order) and status at once, without waiting for approvals (see waitForIntent).',
    access: 'propose',
    domain: true,
    input: xrplIntentInput,
    run: async args => {
      const { custody, input, domainId } = args
      // custody.js builds the transaction order, dry-runs it and proposes that same request only if it passed.
      const { intentId, payloadId } = await custody.xrpl.proposeIntent(
        { Account: input.account, operation: input.operation },
        { dryRun: true, domainId, ledgerId: input.ledgerId, description: input.description },
      )
      return { ...(await withStatus(custody, { domainId, intentId })), payloadId }
    },
  }),

  proposeIntent: defineCustodyTool({
    id: 'proposeIntent',
    description:
      'Propose an Intent with a raw `v0_*` payload, for Intent types with no dedicated tool. Runs a Dry run first and proposes nothing if it fails. Returns the Intent id and status at once, without waiting for approvals (see waitForIntent).',
    access: 'propose',
    domain: true,
    input: intentInput,
    run: async args => {
      const { domainId } = args
      return proposeChecked(args.custody, domainId, await buildRequest(args, domainId, rawPayload(args.input)))
    },
  }),
})
