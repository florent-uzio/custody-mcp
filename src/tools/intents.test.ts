import { CustodyError } from '@florent-uzio/custody'
import { describe, expect, it, vi } from 'vitest'
import { callTool, devOptions as options, fakeCustody, signed } from '../testing'

describe('read tools for Intents', () => {
  /** An Intent as Custody returns it, with the parts a summary does not show. */
  const intent = (id: string, status: string) =>
    signed({
      id,
      details: {
        payload: { type: 'v0_CreateTransactionOrder', parameters: { amount: '10' } },
        expiryAt: '2026-01-02T00:00:00Z',
        author: { id: 'user-alice', domainId: 'domain-1' },
        targetDomainId: 'domain-1',
        metadata: { description: 'Pay Bob', createdAt: '2026-01-01T00:00:00Z', customProperties: {} },
        proposalSignature: 'PROPOSAL SIG',
      },
      state: { status, lastModifiedAt: '2026-01-01T00:01:00Z', progressPerPolicy: [] },
    })

  describe('listIntents', () => {
    it('lists the Intents of the Default domain with the approvals still missing on open ones', async () => {
      const list = vi.fn(async () => ({
        count: 2,
        nextStartingAfter: 'domain-1_intent-2',
        items: [intent('intent-1', 'Open'), intent('intent-2', 'Executed')],
      }))
      const remainingUsers = vi.fn(async () => [{ domainId: 'domain-1', users: ['user-bob', 'user-carol'] }])

      const output = await callTool(options(fakeCustody({ intents: { list, remainingUsers } })), 'listIntents')

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intents: [
          {
            id: 'intent-1',
            type: 'v0_CreateTransactionOrder',
            status: 'Open',
            author: { id: 'user-alice', domainId: 'domain-1' },
            description: 'Pay Bob',
            createdAt: '2026-01-01T00:00:00Z',
            expiryAt: '2026-01-02T00:00:00Z',
            missingApprovals: [{ domainId: 'domain-1', users: ['user-bob', 'user-carol'] }],
          },
          {
            id: 'intent-2',
            type: 'v0_CreateTransactionOrder',
            status: 'Executed',
            author: { id: 'user-alice', domainId: 'domain-1' },
            description: 'Pay Bob',
            createdAt: '2026-01-01T00:00:00Z',
            expiryAt: '2026-01-02T00:00:00Z',
            missingApprovals: [],
          },
        ],
        nextCursor: 'domain-1_intent-2',
      })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 20, startingAfter: undefined })
      // Custody refuses remainingUsers for an Intent that is no longer open.
      expect(remainingUsers).toHaveBeenCalledTimes(1)
      expect(remainingUsers).toHaveBeenCalledWith({ domainId: 'domain-1', intentId: 'intent-1' })
    })
    it('still lists an Intent that stops being open while the page is read', async () => {
      const list = async () => ({ count: 1, items: [intent('intent-1', 'Open')] })
      const remainingUsers = async () => {
        throw new CustodyError({ reason: 'Intent is not opened' }, 400)
      }

      const output = await callTool(options(fakeCustody({ intents: { list, remainingUsers } })), 'listIntents')

      expect(output).toMatchObject({ intents: [{ id: 'intent-1', missingApprovals: [] }] })
    })
  })

  describe('getIntent', () => {
    it('returns the summary of an Intent with its payload and the approvals still missing', async () => {
      const get = vi.fn(async () => intent('intent-1', 'Open'))
      const remainingUsers = async () => [{ domainId: 'domain-1', users: ['user-bob'] }]

      const output = await callTool(options(fakeCustody({ intents: { get, remainingUsers } })), 'getIntent', {
        intentId: 'intent-1',
        domainId: 'domain-9',
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-9',
        intent: {
          id: 'intent-1',
          type: 'v0_CreateTransactionOrder',
          status: 'Open',
          author: { id: 'user-alice', domainId: 'domain-1' },
          description: 'Pay Bob',
          createdAt: '2026-01-01T00:00:00Z',
          expiryAt: '2026-01-02T00:00:00Z',
          missingApprovals: [{ domainId: 'domain-1', users: ['user-bob'] }],
          payload: { type: 'v0_CreateTransactionOrder', parameters: { amount: '10' } },
        },
      })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-9', intentId: 'intent-1' })
    })

    it('says why a failed Intent failed', async () => {
      const failed = intent('intent-1', 'Failed')
      const error = { code: 'InsufficientBalance', message: 'Not enough XRP' }
      const get = async () => ({ ...failed, data: { ...failed.data, state: { ...failed.data.state, error } } })

      const output = await callTool(options(fakeCustody({ intents: { get } })), 'getIntent', { intentId: 'intent-1' })

      expect(output).toMatchObject({ intent: { status: 'Failed', missingApprovals: [], error } })
    })
  })
  describe('listPendingApprovals', () => {
    // The Environment's user is user-me in domain-1 and user-me-root in the parent domain.
    const me = async () => ({
      publicKey: 'PUBLIC KEY',
      domains: [
        { id: 'domain-1', alias: 'Demo', userReference: { id: 'user-me', domainId: 'domain-1' } },
        { id: 'domain-root', alias: 'Root', userReference: { id: 'user-me-root', domainId: 'domain-root' } },
      ],
    })
    const remaining: Record<string, { domainId: string; users: string[] }[]> = {
      'intent-mine': [{ domainId: 'domain-1', users: ['user-bob', 'user-me'] }],
      'intent-others': [{ domainId: 'domain-1', users: ['user-bob'] }],
      'intent-mine-in-root': [{ domainId: 'domain-root', users: ['user-me-root'] }],
      // Same user id, wrong domain: not the Environment's user.
      'intent-lookalike': [{ domainId: 'domain-other', users: ['user-me'] }],
    }
    const remainingUsers = async ({ intentId }: { intentId: string }) => remaining[intentId]

    it("lists only the open Intents still awaiting the Environment user's decision", async () => {
      const list = vi.fn(async () => ({
        count: 4,
        nextStartingAfter: 'domain-1_intent-lookalike',
        items: Object.keys(remaining).map(id => intent(id, 'Open')),
      }))

      const output = await callTool(
        options(fakeCustody({ intents: { list, remainingUsers }, users: { me } })),
        'listPendingApprovals',
        { limit: 4, cursor: 'domain-1_intent-0' },
      )

      expect(output).toMatchObject({
        environment: 'dev',
        domainId: 'domain-1',
        intents: [
          { id: 'intent-mine', status: 'Open', missingApprovals: remaining['intent-mine'] },
          { id: 'intent-mine-in-root', status: 'Open', missingApprovals: remaining['intent-mine-in-root'] },
        ],
        nextCursor: 'domain-1_intent-lookalike',
      })
      expect(list).toHaveBeenCalledWith(
        { domainId: 'domain-1' },
        { limit: 4, startingAfter: 'domain-1_intent-0', 'state.status': ['Open'] },
      )
    })
  })
})
