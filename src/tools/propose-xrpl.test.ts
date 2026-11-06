import { CustodyError } from '@florent-uzio/custody'
import { describe, expect, it, vi } from 'vitest'
import type { AccessLevel } from '../environments'
import { callTool, configFile, DEV, fakeCustody } from '../testing'

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

const payment = {
  type: 'Payment',
  destination: { type: 'Address', address: 'rDestination' },
  amount: '1000000',
}

describe('proposeXrplIntent', () => {
  it('proposes through custody.js with a Dry run first, and returns its Intent id, payload id and status', async () => {
    const proposeIntent = vi.fn(async (_params: object, _options: object) => ({
      requestId: 'server-request-1',
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const get = vi.fn(async ({ intentId }: { intentId: string }) => ({
      data: { id: intentId, state: { status: 'Open' } },
    }))

    const output = await callTool(options({ xrpl: { proposeIntent }, intents: { get } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
      description: 'Pay the supplier',
    })

    expect(proposeIntent).toHaveBeenCalledWith(
      { Account: ADDRESS, operation: payment },
      { dryRun: true, domainId: 'domain-1', ledgerId: undefined, description: 'Pay the supplier' },
    )
    expect(get).toHaveBeenCalledWith({ domainId: 'domain-1', intentId: 'intent-1' })
    expect(output).toEqual({
      environment: 'dev',
      domainId: 'domain-1',
      intentId: 'intent-1',
      payloadId: 'payload-1',
      status: 'Open',
    })
  })

  it('passes a sponsorship through to custody.js', async () => {
    const proposeIntent = vi.fn(async (_params: object, _options: object) => ({
      requestId: 'r',
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const get = vi.fn(async () => ({ data: { state: { status: 'Open' } } }))
    const sponsorship = { sponsor: { type: 'Address', address: 'rSponsor' }, flags: ['spfSponsorFee'] }

    await callTool(options({ xrpl: { proposeIntent }, intents: { get } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
      sponsorship,
    })

    expect(proposeIntent.mock.calls[0][0]).toEqual({ Account: ADDRESS, operation: payment, sponsorship })
  })

  it('proposes a SponsorshipSetAsSponsor operation', async () => {
    const proposeIntent = vi.fn(async (_params: object, _options: object) => ({
      requestId: 'r',
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const get = vi.fn(async () => ({ data: { state: { status: 'Open' } } }))
    const operation = {
      type: 'SponsorshipSetAsSponsor',
      sponsee: { type: 'Address', address: 'rSponsee' },
      feeAmountDelta: '1000000',
      flags: [],
    }

    await callTool(options({ xrpl: { proposeIntent }, intents: { get } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation,
    })

    expect(proposeIntent.mock.calls[0][0]).toEqual({ Account: ADDRESS, operation })
  })

  it('rejects an invalid operation with a field-level message, without calling Custody', async () => {
    const proposeIntent = vi.fn()

    const output = await callTool(options({ xrpl: { proposeIntent } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: { type: 'Payment', amount: '1000000' },
    })

    expect(output).toEqual({ error: expect.stringMatching(/operation.*destination/s) })
    expect(proposeIntent).not.toHaveBeenCalled()
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
    const proposeIntent = vi.fn(async (_params: object, _options: object) => ({
      requestId: 'server-request-1',
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const get = vi.fn(async () => ({ data: { state: { status: 'Open' } } }))

    const output = await callTool(options({ xrpl: { proposeIntent }, intents: { get } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation,
    })

    expect(proposeIntent).toHaveBeenCalledWith(
      { Account: ADDRESS, operation },
      expect.objectContaining({ dryRun: true }),
    )
    expect(output).toMatchObject({ environment: 'dev', status: 'Open' })
  })

  it("returns Custody's reasons when the Dry run fails, saying nothing was proposed", async () => {
    // custody.js proposes nothing when its Dry run fails, and throws with Custody's reasons.
    const proposeIntent = vi.fn(async () => {
      throw new CustodyError({
        reason: 'Dry run failed, intent not proposed: Destination rDestination does not exist',
      })
    })
    const get = vi.fn()

    const output = await callTool(options({ xrpl: { proposeIntent }, intents: { get } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
    })

    expect(output).toEqual({
      error: expect.stringMatching(/not proposed.*Destination rDestination does not exist/),
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('says when no Custody account holds the address', async () => {
    const proposeIntent = vi.fn(async () => {
      throw new CustodyError({ reason: `Account not found for address ${ADDRESS} in domain domain-1` })
    })

    const output = await callTool(options({ xrpl: { proposeIntent } }), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
    })

    expect(output).toEqual({ error: expect.stringContaining(`Account not found for address ${ADDRESS}`) })
  })

  it('refuses on a read-only Environment, or without a named Environment, without calling Custody', async () => {
    const proposeIntent = vi.fn()
    const custody = { xrpl: { proposeIntent } }

    const readOnly = await callTool(options(custody, 'read'), 'proposeXrplIntent', {
      environment: 'dev',
      account: ADDRESS,
      operation: payment,
    })
    const unnamed = await callTool(options(custody), 'proposeXrplIntent', { account: ADDRESS, operation: payment })

    expect(readOnly).toEqual({ error: expect.stringContaining('"propose" Access level') })
    expect(unnamed).toEqual({ error: expect.stringContaining('environment') })
    expect(proposeIntent).not.toHaveBeenCalled()
  })
})

describe('dryRunXrplIntent', () => {
  it("runs a Dry run through custody.js without proposing, even on a read-only default Environment, and returns Custody's verdict and fee", async () => {
    const dryRunIntent = vi.fn(async (_params: object, _options: object) => ({
      type: 'v0_CreateTransactionOrder',
      success: false,
      errors: ['Destination rDestination does not exist'],
      result: { type: 'Failure', reason: 'tecNO_DST', hint: {} },
      estimate: { type: 'XRPL', fee: '12' },
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const proposeIntent = vi.fn()

    const output = await callTool(options({ xrpl: { dryRunIntent, proposeIntent } }, 'read'), 'dryRunXrplIntent', {
      account: ADDRESS,
      operation: payment,
    })

    expect(dryRunIntent).toHaveBeenCalledWith(
      { Account: ADDRESS, operation: payment },
      { domainId: 'domain-1', ledgerId: undefined, description: undefined },
    )
    expect(output).toEqual({
      environment: 'dev',
      domainId: 'domain-1',
      success: false,
      errors: ['Destination rDestination does not exist'],
      estimate: { type: 'XRPL', fee: '12' },
    })
    expect(proposeIntent).not.toHaveBeenCalled()
  })

  it('rejects an invalid operation with a field-level message, without calling Custody', async () => {
    const dryRunIntent = vi.fn()

    const output = await callTool(options({ xrpl: { dryRunIntent } }, 'read'), 'dryRunXrplIntent', {
      account: ADDRESS,
      operation: { type: 'Payment', amount: '1000000' },
    })

    expect(output).toEqual({ error: expect.stringMatching(/operation.*destination/s) })
    expect(dryRunIntent).not.toHaveBeenCalled()
  })
})
