import { CustodyError } from '@florent-uzio/custody'
import { describe, expect, it, vi } from 'vitest'
import type { AccessLevel } from './environments'
import { callTool, configFile, DEV, fakeCustody } from './testing'

// One Environment with a Default domain at the given Access level; its key comes from an env var.
const options = (custody: object, access: AccessLevel = 'propose') => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', access, defaultDomainId: 'domain-1' } },
    }),
  },
  connect: () => fakeCustody(custody),
})

const payload = { type: 'v0_LockAccount', accountId: 'account-1' }

// The Environment's user, with its own user id in the Default domain.
const me = async () => ({
  loginId: { id: 'login-1' },
  domains: [{ id: 'domain-1', alias: 'Main', userReference: { id: 'user-1' } }],
})

describe('proposing with guardrails', () => {
  describe('proposeIntent', () => {
    it('refuses on a read-only Environment, naming the level needed, without calling Custody', async () => {
      const dryRun = vi.fn()
      const propose = vi.fn()

      const output = await callTool(options({ intents: { dryRun, propose } }, 'read'), 'proposeIntent', {
        environment: 'dev',
        payload,
      })

      expect(output).toEqual({ error: expect.stringContaining('"propose" Access level') })
      expect(dryRun).not.toHaveBeenCalled()
      expect(propose).not.toHaveBeenCalled()
    })

    it('refuses unless the Environment is named, even when there is a default, without calling Custody', async () => {
      const dryRun = vi.fn()
      const propose = vi.fn()

      const output = await callTool(options({ intents: { dryRun, propose } }), 'proposeIntent', { payload })

      expect(output).toEqual({ error: expect.stringContaining('environment') })
      expect(dryRun).not.toHaveBeenCalled()
      expect(propose).not.toHaveBeenCalled()
    })

    it("does not propose when the Dry run fails, and returns Custody's reasons", async () => {
      const dryRun = vi.fn(async () => ({
        type: 'v0_LockAccount',
        success: false,
        errors: ['Account account-1 is already locked'],
      }))
      const propose = vi.fn()

      const output = await callTool(options({ users: { me }, intents: { dryRun, propose } }), 'proposeIntent', {
        environment: 'dev',
        payload,
      })

      expect(output).toEqual({ error: expect.stringContaining('Account account-1 is already locked') })
      expect(dryRun).toHaveBeenCalled()
      expect(propose).not.toHaveBeenCalled()
    })

    it('proposes exactly the request that passed the Dry run, and returns the Intent id and status', async () => {
      const dryRun = vi.fn(async (_request: object) => ({ type: 'v0_LockAccount', success: true }))
      const propose = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))
      const get = vi.fn(async ({ intentId }: { intentId: string }) => ({
        data: { id: intentId, state: { status: 'Open' } },
      }))

      const output = await callTool(options({ users: { me }, intents: { dryRun, propose, get } }), 'proposeIntent', {
        environment: 'dev',
        payload,
        description: 'Lock the hot wallet',
      })

      const dryRunRequest = dryRun.mock.calls[0][0]
      expect(dryRunRequest).toEqual({
        author: { domainId: 'domain-1', id: 'user-1' },
        targetDomainId: 'domain-1',
        id: expect.any(String),
        expiryAt: expect.any(String),
        payload,
        customProperties: {},
        description: 'Lock the hot wallet',
      })
      expect(propose).toHaveBeenCalledWith({ request: { ...dryRunRequest, type: 'Propose' } })
      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intentId: (dryRunRequest as { id: string }).id,
        status: 'Open',
      })
    })

    it('never reports an error once Custody accepted the Propose, so the model does not propose twice', async () => {
      const dryRun = vi.fn(async () => ({ type: 'v0_LockAccount', success: true }))
      const propose = vi.fn(async () => ({ requestId: 'server-request-1' }))
      const get = vi.fn(async () => {
        throw new Error('Not found')
      })

      const output = await callTool(options({ users: { me }, intents: { dryRun, propose, get } }), 'proposeIntent', {
        environment: 'dev',
        payload,
      })

      expect(output).not.toHaveProperty('error')
      expect(output).toMatchObject({ environment: 'dev', domainId: 'domain-1', intentId: expect.any(String) })
      expect(propose).toHaveBeenCalledTimes(1)
    })
  })

  describe('dryRunIntent', () => {
    it("runs a Dry run without proposing, even on a read-only default Environment, and returns Custody's verdict", async () => {
      const dryRun = vi.fn(async () => ({
        type: 'v0_LockAccount',
        success: false,
        errors: ['Account account-1 is already locked'],
      }))
      const propose = vi.fn()

      const output = await callTool(options({ users: { me }, intents: { dryRun, propose } }, 'read'), 'dryRunIntent', {
        payload,
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        success: false,
        errors: ['Account account-1 is already locked'],
      })
      expect(propose).not.toHaveBeenCalled()
    })
  })

  describe('waitForIntent', () => {
    const intent = (status: string) => ({ data: { id: 'intent-1', state: { status } } })

    it('waits about 30 seconds by default, then says the Intent is still awaiting approval, without an error', async () => {
      const getAndWait = vi.fn(async (_params: object, _options: { maxRetries: number; intervalMs: number }) => ({
        status: 'Open',
        isTerminal: false,
        isSuccess: false,
        intent: intent('Open'),
      }))

      const output = await callTool(options({ intents: { getAndWait } }), 'waitForIntent', { intentId: 'intent-1' })

      const [params, { maxRetries, intervalMs }] = getAndWait.mock.calls[0]
      expect(params).toEqual({ domainId: 'domain-1', intentId: 'intent-1' })
      expect(maxRetries * intervalMs).toBe(30_000)
      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intentId: 'intent-1',
        status: 'Open',
        done: false,
        message: expect.stringContaining('still awaiting approval'),
      })
    })

    it('reports an Intent Custody cannot find yet as not done, without an error', async () => {
      const getAndWait = vi.fn(async () => {
        throw new CustodyError({ reason: 'Intent intent-1 not found after 10 attempts' }, 404)
      })

      const output = await callTool(options({ intents: { getAndWait } }), 'waitForIntent', { intentId: 'intent-1' })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        intentId: 'intent-1',
        done: false,
        message: expect.stringContaining('not visible in Custody yet'),
      })
    })

    it('says that Executed means Custody accepted the order, not that it settled on the ledger', async () => {
      const getAndWait = vi.fn(async () => ({
        status: 'Executed',
        isTerminal: true,
        isSuccess: true,
        intent: intent('Executed'),
      }))

      const output = await callTool(options({ intents: { getAndWait } }), 'waitForIntent', { intentId: 'intent-1' })

      expect(output).toMatchObject({
        status: 'Executed',
        done: true,
        message: expect.stringContaining('not that it settled on the ledger'),
      })
    })
  })
})
