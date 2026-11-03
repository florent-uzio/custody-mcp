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

const ADDRESS = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'

// The Environment's user, with its own user id in the Default domain.
const me = async () => ({
  loginId: { id: 'login-1' },
  domains: [{ id: 'domain-1', alias: 'Main', userReference: { id: 'user-1' } }],
})

// The Custody account that holds ADDRESS.
const findByAddress = async (address: string) => ({
  domainId: 'domain-1',
  accountId: 'account-1',
  ledgerId: 'xrpl-testnet',
  address,
})

const payment = {
  type: 'Payment',
  destination: { type: 'Address', address: 'rDestination' },
  amount: '1000000',
}

describe('proposeXrplIntent', () => {
  it('proposes the transaction order that passed the Dry run, and returns its Intent id, payload id and status', async () => {
    const dryRun = vi.fn(async (_request: object) => ({ type: 'v0_CreateTransactionOrder', success: true }))
    const propose = vi.fn(async (_body: object) => ({ requestId: 'server-request-1' }))
    const get = vi.fn(async ({ intentId }: { intentId: string }) => ({
      data: { id: intentId, state: { status: 'Open' } },
    }))

    const output = await callTool(
      options({ users: { me }, accounts: { findByAddress }, intents: { dryRun, propose, get } }),
      'proposeXrplIntent',
      { environment: 'dev', account: ADDRESS, operation: payment, description: 'Pay the supplier' },
    )

    const dryRunRequest = dryRun.mock.calls[0][0] as { id: string; payload: { id: string } }
    expect(dryRunRequest).toEqual({
      author: { domainId: 'domain-1', id: 'user-1' },
      targetDomainId: 'domain-1',
      id: expect.any(String),
      expiryAt: expect.any(String),
      payload: {
        type: 'v0_CreateTransactionOrder',
        id: expect.any(String),
        accountId: 'account-1',
        ledgerId: 'xrpl-testnet',
        customProperties: {},
        parameters: {
          type: 'XRPL',
          feeStrategy: { type: 'Priority', priority: 'Low' },
          memos: [],
          operation: payment,
        },
      },
      customProperties: {},
      description: 'Pay the supplier',
    })
    expect(propose).toHaveBeenCalledWith({ request: { ...dryRunRequest, type: 'Propose' } })
    expect(output).toEqual({
      environment: 'dev',
      domainId: 'domain-1',
      intentId: dryRunRequest.id,
      payloadId: dryRunRequest.payload.id,
      status: 'Open',
    })
  })

  it('rejects an invalid operation with a field-level message, without calling Custody', async () => {
    const findByAddress = vi.fn()
    const dryRun = vi.fn()
    const propose = vi.fn()

    const output = await callTool(
      options({ users: { me }, accounts: { findByAddress }, intents: { dryRun, propose } }),
      'proposeXrplIntent',
      { environment: 'dev', account: ADDRESS, operation: { type: 'Payment', amount: '1000000' } },
    )

    expect(output).toEqual({ error: expect.stringMatching(/operation.*destination/s) })
    expect(findByAddress).not.toHaveBeenCalled()
    expect(dryRun).not.toHaveBeenCalled()
    expect(propose).not.toHaveBeenCalled()
  })

  it.each([
    {
      type: 'TrustSet',
      limitAmount: { currency: { type: 'Currency', code: 'USD', issuer: 'rIssuer' }, value: '1000' },
      flags: [],
    },
    {
      type: 'MPTokenIssuanceCreate',
      flags: ['tfMPTCanTransfer', 'tfMPTCanClawback'],
      assetScale: 2,
      maximumAmount: '100000000',
    },
    {
      type: 'MPTokenAuthorize',
      tokenIdentifier: { type: 'MPTokenIssuanceId', issuanceId: '0000012FFD9EE5DA93AC614B4DB94D7E0FCE415CA51BED47' },
      flags: [],
    },
  ])('proposes a $type operation as given', async operation => {
    const dryRun = vi.fn(async (_request: object) => ({ type: 'v0_CreateTransactionOrder', success: true }))
    const propose = vi.fn(async () => ({ requestId: 'server-request-1' }))
    const get = vi.fn(async () => ({ data: { state: { status: 'Open' } } }))

    const output = await callTool(
      options({ users: { me }, accounts: { findByAddress }, intents: { dryRun, propose, get } }),
      'proposeXrplIntent',
      { environment: 'dev', account: ADDRESS, operation },
    )

    expect(dryRun.mock.calls[0][0]).toMatchObject({ payload: { parameters: { operation } } })
    expect(propose).toHaveBeenCalledTimes(1)
    expect(output).toMatchObject({ environment: 'dev', status: 'Open' })
  })

  it("does not propose when the Dry run fails, and returns Custody's reasons", async () => {
    const dryRun = vi.fn(async () => ({
      type: 'v0_CreateTransactionOrder',
      success: false,
      errors: ['Destination rDestination does not exist'],
    }))
    const propose = vi.fn()

    const output = await callTool(
      options({ users: { me }, accounts: { findByAddress }, intents: { dryRun, propose } }),
      'proposeXrplIntent',
      { environment: 'dev', account: ADDRESS, operation: payment },
    )

    expect(output).toEqual({ error: expect.stringContaining('Destination rDestination does not exist') })
    expect(dryRun).toHaveBeenCalled()
    expect(propose).not.toHaveBeenCalled()
  })

  it('refuses on a read-only Environment, or without a named Environment, without calling Custody', async () => {
    const findByAddress = vi.fn()
    const dryRun = vi.fn()
    const custody = { users: { me }, accounts: { findByAddress }, intents: { dryRun } }

    const readOnly = await callTool(options(custody, 'read'), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
    })
    const unnamed = await callTool(options(custody), 'proposeXrplIntent', { account: ADDRESS, operation: payment })

    expect(readOnly).toEqual({ error: expect.stringContaining('"propose" Access level') })
    expect(unnamed).toEqual({ error: expect.stringContaining('environment') })
    expect(findByAddress).not.toHaveBeenCalled()
    expect(dryRun).not.toHaveBeenCalled()
  })
})
