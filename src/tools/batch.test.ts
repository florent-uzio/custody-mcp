import { describe, expect, it, vi } from 'vitest'
import type { AccessLevel } from '../environments'
import { callTool, configFile, DEV, fakeCustody } from '../testing'

const options = (custody: object, access: AccessLevel = 'propose') => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', access, defaultDomainId: 'domain-1' } },
    }),
  },
  connect: () => fakeCustody(custody),
})

const ACCOUNT = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'

const batch = {
  account: ACCOUNT,
  executionMode: 'AllOrNothing',
  entries: [
    {
      type: 'SubmitterOperation',
      operation: { type: 'Payment', destination: { type: 'Address', address: 'rDestination' }, amount: '1' },
      sequencing: { type: 'PlatformManaged' },
    },
  ],
}

const signer = {
  participant: { type: 'Account', accountId: 'account-2' },
  account: 'rSigner',
  signingPayload: 'AA',
  signingPayloadHash: 'BB',
}

describe('dryRunBatchIntent', () => {
  it('returns the signers, and leaves out the deprecated top-level signing payload', async () => {
    const dryRunBatch = vi.fn(async (_payload: object, _options: object) => ({
      signingPayload: 'DEPRECATED',
      signingPayloadHash: 'DEPRECATED',
      executionMode: 'AllOrNothing',
      transactions: [],
      signers: [signer],
    }))

    const output = await callTool(options({ xrpl: { dryRunBatch } }, 'read'), 'dryRunBatchIntent', {
      environment: 'dev',
      ...batch,
    })

    expect(dryRunBatch).toHaveBeenCalledWith(
      { Account: ACCOUNT, executionMode: 'AllOrNothing', entries: batch.entries },
      { domainId: 'domain-1', ledgerId: undefined, description: undefined },
    )
    expect(output).toEqual({
      environment: 'dev',
      domainId: 'domain-1',
      executionMode: 'AllOrNothing',
      transactions: [],
      signers: [signer],
    })
  })

  it('passes an outer sponsorship through', async () => {
    const dryRunBatch = vi.fn(async (_payload: object, _options: object) => ({
      executionMode: 'AllOrNothing',
      transactions: [],
      signers: [],
    }))
    const sponsorship = { sponsor: { type: 'Address', address: 'rSponsor' }, flags: ['spfSponsorFee'] }

    await callTool(options({ xrpl: { dryRunBatch } }, 'read'), 'dryRunBatchIntent', {
      environment: 'dev',
      ...batch,
      sponsorship,
    })

    expect(dryRunBatch.mock.calls[0][0]).toMatchObject({ sponsorship })
  })
})

describe('signBatchSigner', () => {
  it('signs the entry unchanged and returns at once with what getBatchSignature needs', async () => {
    const signBatchPayload = vi.fn(async (_signer: object, _options: object) => ({
      payloadId: 'payload-1',
      domainId: 'domain-1',
      accountId: 'account-2',
      signerAddress: 'rSigner',
      participant: signer.participant,
      signingPubKey: 'PUB',
      intentResponse: { requestId: 'intent-1' },
    }))

    const output = await callTool(options({ xrpl: { signBatchPayload } }), 'signBatchSigner', {
      environment: 'dev',
      signer,
    })

    expect(signBatchPayload).toHaveBeenCalledWith(signer, {
      domainId: 'domain-1',
      ledgerId: undefined,
      description: undefined,
    })
    expect(output).toMatchObject({
      intentId: 'intent-1',
      payloadId: 'payload-1',
      accountId: 'account-2',
      signerAddress: 'rSigner',
      participant: signer.participant,
      signingPubKey: 'PUB',
    })
  })

  it('needs the propose Access level', async () => {
    const signBatchPayload = vi.fn()

    const output = await callTool(options({ xrpl: { signBatchPayload } }, 'read'), 'signBatchSigner', {
      environment: 'dev',
      signer,
    })

    expect(output).toEqual({ error: expect.stringContaining('"propose" Access level') })
    expect(signBatchPayload).not.toHaveBeenCalled()
  })
})

describe('getBatchSignature', () => {
  const handle = {
    environment: 'dev',
    payloadId: 'payload-1',
    accountId: 'account-2',
    signerAddress: 'rSigner',
    participant: signer.participant,
    signingPubKey: 'PUB',
  }
  const { environment: _environment, ...params } = handle

  it('says when the signature is not available yet', async () => {
    const getBatchSignature = vi.fn(async (_params: object) => undefined)

    const output = await callTool(options({ xrpl: { getBatchSignature } }, 'read'), 'getBatchSignature', handle)

    expect(getBatchSignature).toHaveBeenCalledWith({ ...params, domainId: 'domain-1' })
    expect(output).toMatchObject({ signed: false, message: expect.stringContaining('not an error') })
  })

  it('returns the Custody batch signer once signed', async () => {
    const custodyBatchSigner = { participant: signer.participant, publicKey: 'PUB', signature: 'SIG' }
    const getBatchSignature = vi.fn(async (_params: object) => ({ custodyBatchSigner }))

    const output = await callTool(options({ xrpl: { getBatchSignature } }, 'read'), 'getBatchSignature', handle)

    expect(output).toMatchObject({ signed: true, batchSigner: custodyBatchSigner })
  })
})

describe('proposeBatchIntent', () => {
  it('proposes the Batch with its signers', async () => {
    const proposeBatch = vi.fn(async (_payload: object, _signers: object[], _options: object) => ({
      requestId: 'intent-1',
      intentId: 'intent-1',
      payloadId: 'payload-1',
    }))
    const batchSigners = [{ participant: signer.participant, publicKey: 'PUB', signature: 'SIG' }]

    const output = await callTool(options({ xrpl: { proposeBatch } }), 'proposeBatchIntent', {
      environment: 'dev',
      ...batch,
      batchSigners,
      description: 'Batch',
    })

    expect(proposeBatch).toHaveBeenCalledWith(
      { Account: ACCOUNT, executionMode: 'AllOrNothing', entries: batch.entries },
      batchSigners,
      { domainId: 'domain-1', ledgerId: undefined, description: 'Batch' },
    )
    expect(output).toMatchObject({ intentId: 'intent-1', payloadId: 'payload-1' })
  })

  it('rejects an entry with no sequencing without calling Custody', async () => {
    const proposeBatch = vi.fn()

    const output = await callTool(options({ xrpl: { proposeBatch } }), 'proposeBatchIntent', {
      environment: 'dev',
      ...batch,
      entries: [{ type: 'SubmitterOperation', operation: batch.entries[0].operation }],
      batchSigners: [],
    })

    expect(output).toEqual({ error: expect.stringMatching(/sequencing/) })
    expect(proposeBatch).not.toHaveBeenCalled()
  })
})
