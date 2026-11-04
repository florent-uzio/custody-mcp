import { describe, expect, it, vi } from 'vitest'
import type { AccessLevel } from '../environments'
import { callTool, callToolOverMcp, configFile, DEV, fakeCustody } from '../testing'

// One Environment with a Default domain at the given Access level; its key comes from an env var.
const options = (custody: object, access: AccessLevel = 'approve') => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', access, defaultDomainId: 'domain-1' } },
    }),
  },
  connect: () => fakeCustody(custody),
})

// The Environment's user, with its own user id in the Default domain.
const me = async () => ({
  loginId: { id: 'login-1' },
  domains: [{ id: 'domain-1', alias: 'Main', userReference: { id: 'user-1' } }],
})

// An open Intent proposed by someone else, as Custody returns it.
const get = async ({ intentId }: { intentId: string }) => ({
  data: {
    id: intentId,
    details: {
      payload: { type: 'v0_LockAccount', accountId: 'account-1' },
      author: { domainId: 'domain-1', id: 'user-2' },
      targetDomainId: 'domain-1',
      expiryAt: '2026-11-04T00:00:00.000Z',
      metadata: { description: 'Lock the hot wallet', createdAt: '2026-11-03T00:00:00.000Z', customProperties: {} },
      proposalSignature: 'proposal-signature-1',
    },
    state: { status: 'Open' },
  },
})

describe('deciding on Intents with confirmation', () => {
  describe('approveIntent', () => {
    it('approves once the human accepts a confirmation that summarizes the Intent', async () => {
      const approve = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))
      const elicit = vi.fn(async (_request: { params: { message?: string } }) => ({
        action: 'accept' as const,
        content: {},
      }))

      const output = await callToolOverMcp(
        options({ users: { me }, intents: { get, approve } }),
        'approveIntent',
        { environment: 'dev', intentId: 'intent-1' },
        elicit,
      )

      expect(elicit).toHaveBeenCalledTimes(1)
      expect(elicit.mock.calls[0][0].params.message).toContain('Lock the hot wallet')
      expect(approve).toHaveBeenCalledWith({
        request: {
          author: { domainId: 'domain-1', id: 'user-1' },
          targetDomainId: 'domain-1',
          intentId: 'intent-1',
          proposalSignature: 'proposal-signature-1',
          type: 'Approve',
        },
      })
      expect(output).toEqual({ environment: 'dev', domainId: 'domain-1', intentId: 'intent-1' })
    })

    it('does not approve when the human declines', async () => {
      const approve = vi.fn()
      const elicit = vi.fn(async () => ({ action: 'decline' as const }))

      const output = await callToolOverMcp(
        options({ users: { me }, intents: { get, approve } }),
        'approveIntent',
        { environment: 'dev', intentId: 'intent-1' },
        elicit,
      )

      expect(elicit).toHaveBeenCalledTimes(1)
      expect(approve).not.toHaveBeenCalled()
      expect(output).toEqual({ error: expect.stringContaining('declined') })
    })

    it('approves on a client that cannot show a confirmation, and says none was shown', async () => {
      const approve = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))

      const output = await callToolOverMcp(options({ users: { me }, intents: { get, approve } }), 'approveIntent', {
        environment: 'dev',
        intentId: 'intent-1',
      })

      expect(approve).toHaveBeenCalledTimes(1)
      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intentId: 'intent-1',
        note: expect.stringContaining('No in-client confirmation was shown'),
      })
    })

    it('refuses on an Environment below the approve Access level, without calling Custody', async () => {
      const get = vi.fn()
      const approve = vi.fn()

      const output = await callTool(options({ intents: { get, approve } }, 'propose'), 'approveIntent', {
        environment: 'dev',
        intentId: 'intent-1',
      })

      expect(output).toEqual({ error: expect.stringContaining('"approve" Access level') })
      expect(get).not.toHaveBeenCalled()
      expect(approve).not.toHaveBeenCalled()
    })

    it('refuses unless the Environment is named, even when there is a default, without calling Custody', async () => {
      const get = vi.fn()
      const approve = vi.fn()

      const output = await callTool(options({ intents: { get, approve } }), 'approveIntent', { intentId: 'intent-1' })

      expect(output).toEqual({ error: expect.stringContaining('environment') })
      expect(get).not.toHaveBeenCalled()
      expect(approve).not.toHaveBeenCalled()
    })
  })

  describe('rejectIntent', () => {
    it('rejects with the reason given once the human accepts a confirmation that summarizes the Intent', async () => {
      const reject = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))
      const elicit = vi.fn(async (_request: { params: { message?: string } }) => ({
        action: 'accept' as const,
        content: {},
      }))

      const output = await callToolOverMcp(
        options({ users: { me }, intents: { get, reject } }),
        'rejectIntent',
        { environment: 'dev', intentId: 'intent-1', reason: 'Wrong account' },
        elicit,
      )

      expect(elicit).toHaveBeenCalledTimes(1)
      expect(elicit.mock.calls[0][0].params.message).toContain('Lock the hot wallet')
      expect(reject).toHaveBeenCalledWith({
        request: {
          author: { domainId: 'domain-1', id: 'user-1' },
          targetDomainId: 'domain-1',
          intentId: 'intent-1',
          proposalSignature: 'proposal-signature-1',
          rejectReason: 'Wrong account',
          type: 'Reject',
        },
      })
      expect(output).toEqual({ environment: 'dev', domainId: 'domain-1', intentId: 'intent-1' })
    })

    it('does not reject when the human declines', async () => {
      const reject = vi.fn()
      const elicit = vi.fn(async () => ({ action: 'decline' as const }))

      const output = await callToolOverMcp(
        options({ users: { me }, intents: { get, reject } }),
        'rejectIntent',
        { environment: 'dev', intentId: 'intent-1', reason: 'Wrong account' },
        elicit,
      )

      expect(elicit).toHaveBeenCalledTimes(1)
      expect(reject).not.toHaveBeenCalled()
      expect(output).toEqual({ error: expect.stringContaining('declined') })
    })

    it('rejects on a client that cannot show a confirmation, and says none was shown', async () => {
      const reject = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))

      const output = await callToolOverMcp(options({ users: { me }, intents: { get, reject } }), 'rejectIntent', {
        environment: 'dev',
        intentId: 'intent-1',
        reason: 'Wrong account',
      })

      expect(reject).toHaveBeenCalledTimes(1)
      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intentId: 'intent-1',
        note: expect.stringContaining('No in-client confirmation was shown'),
      })
    })

    it('refuses on an Environment below the approve Access level, without calling Custody', async () => {
      const get = vi.fn()
      const reject = vi.fn()

      const output = await callTool(options({ intents: { get, reject } }, 'propose'), 'rejectIntent', {
        environment: 'dev',
        intentId: 'intent-1',
        reason: 'Wrong account',
      })

      expect(output).toEqual({ error: expect.stringContaining('"approve" Access level') })
      expect(get).not.toHaveBeenCalled()
      expect(reject).not.toHaveBeenCalled()
    })

    it('refuses unless the Environment is named, even when there is a default, without calling Custody', async () => {
      const get = vi.fn()
      const reject = vi.fn()

      const output = await callTool(options({ intents: { get, reject } }), 'rejectIntent', {
        intentId: 'intent-1',
        reason: 'Wrong account',
      })

      expect(output).toEqual({ error: expect.stringContaining('environment') })
      expect(get).not.toHaveBeenCalled()
      expect(reject).not.toHaveBeenCalled()
    })
  })
})
