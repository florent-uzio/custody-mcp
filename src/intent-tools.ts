import { CustodyError, type Core_RemainingDomainUsers, type Core_TrustedIntent } from '@florent-uzio/custody'
import { z } from 'zod'
import { domainIdFor, domainInput, nextCursor, pageInput, pageQuery, type DefineCustodyTool } from './custody-tool'
import type { CustodyClient } from './custody'

// custody.js 2.14 types these two responses wrongly: getIntents returns a page of Intents, and
// getRemainingUsers one entry per domain (see the OpenAPI operations of the same names).
const listIntents = (custody: CustodyClient, ...args: Parameters<CustodyClient['intents']['list']>) =>
  custody.intents.list(...args) as unknown as Promise<{ items: Core_TrustedIntent[]; nextStartingAfter?: string }>

/** The users who can still approve an Intent, per domain. Only an open Intent has any. */
const missingApprovals = async (custody: CustodyClient, domainId: string, { data }: Core_TrustedIntent) => {
  if (data.state.status !== 'Open') {
    return []
  }
  try {
    return (await custody.intents.remainingUsers({
      domainId,
      intentId: data.id,
    })) as unknown as Core_RemainingDomainUsers[]
  } catch (error) {
    // 400 is IntentNotOpenedError: the Intent was decided after the page was read.
    if (error instanceof CustodyError && error.statusCode === 400) {
      return []
    }
    throw error
  }
}

const summarize = async (custody: CustodyClient, domainId: string, intent: Core_TrustedIntent) => {
  const { id, details, state } = intent.data
  return {
    id,
    type: details.payload.type,
    status: state.status,
    author: details.author,
    description: details.metadata.description,
    createdAt: details.metadata.createdAt,
    expiryAt: details.expiryAt,
    missingApprovals: await missingApprovals(custody, domainId, intent),
  }
}

/** Read tools for the Intents of a Custody domain. */
export const createIntentTools = (defineCustodyTool: DefineCustodyTool) => ({
  listIntents: defineCustodyTool({
    id: 'listIntents',
    description:
      'List the Intents of a Custody domain, one page at a time: type, status, author and the approvals still missing.',
    input: { ...domainInput, ...pageInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { custody } = args
      const page = await listIntents(custody, { domainId }, pageQuery(args.input))
      return {
        domainId,
        intents: await Promise.all(page.items.map(item => summarize(custody, domainId, item))),
        ...nextCursor(page),
      }
    },
  }),

  listPendingApprovals: defineCustodyTool({
    id: 'listPendingApprovals',
    description:
      "List the open Intents of a Custody domain still awaiting the Environment user's decision, one page at a time. A page can hold fewer items than the limit, or none, and still have a nextCursor: follow it to see the rest.",
    input: { ...domainInput, ...pageInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { custody } = args
      const [me, page] = await Promise.all([
        custody.users.me(),
        listIntents(custody, { domainId }, { ...pageQuery(args.input), 'state.status': ['Open'] }),
      ])
      // The user has one id per domain it belongs to; an approver can sit in a parent domain.
      const isMe = (userDomainId: string, userId: string) =>
        me.domains.some(domain => domain.id === userDomainId && domain.userReference.id === userId)
      const intents = await Promise.all(page.items.map(item => summarize(custody, domainId, item)))
      return {
        domainId,
        intents: intents.filter(intent =>
          intent.missingApprovals.some(({ domainId, users }) => users.some(userId => isMe(domainId, userId))),
        ),
        ...nextCursor(page),
      }
    },
  }),

  getIntent: defineCustodyTool({
    id: 'getIntent',
    description:
      'Get one Intent of a Custody domain: its summary, what it proposes (payload), why it failed if it did, and the approvals still missing.',
    input: { ...domainInput, intentId: z.string().describe('Id of the Intent (see listIntents).') },
    run: async args => {
      const domainId = await domainIdFor(args)
      const intent = await args.custody.intents.get({ domainId, intentId: args.input.intentId })
      const { payload } = intent.data.details
      const { error } = intent.data.state
      return { domainId, intent: { ...(await summarize(args.custody, domainId, intent)), payload, error } }
    },
  }),
})
