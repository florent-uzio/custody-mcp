import { describe, expect, it, vi } from 'vitest'
import type { CustodyClient } from '../custody'
import { callTool, configFile, DEV, fakeCustody } from '../testing'

const options = (custody: CustodyClient) => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', defaultDomainId: 'domain-1' } },
    }),
  },
  connect: () => custody,
})

describe('inbox balance decryption tools', () => {
  describe('decryptConfidentialInboxBalance', () => {
    it('decrypts the inbox balance and returns the amount', async () => {
      const initiateAndWait = vi.fn(async () => ({
        status: 'Completed',
        isTerminal: true,
        isSuccess: true,
        decryption: { id: 'req-1', status: 'Completed', decryptedAmount: '700' },
      }))
      const custody = fakeCustody({ internal: { cbInDecryption: { initiateAndWait } } })

      const output = await callTool(options(custody), 'decryptConfidentialInboxBalance', {
        accountId: 'account-1',
        ledgerId: 'ledger-1',
        issuanceId: 'ISSUANCE',
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        accountId: 'account-1',
        issuanceId: 'ISSUANCE',
        requestId: 'req-1',
        status: 'Completed',
        isTerminal: true,
        decryptedAmount: '700',
        error: undefined,
      })
      expect(initiateAndWait).toHaveBeenCalledWith({
        accountId: 'account-1',
        domainId: 'domain-1',
        ledgerId: 'ledger-1',
        issuanceId: 'ISSUANCE',
      })
    })

    it('returns the request id of a decryption still pending, to follow later', async () => {
      const initiateAndWait = async () => ({
        status: 'Preparing',
        isTerminal: false,
        isSuccess: false,
        decryption: { id: 'req-2', status: 'Preparing' },
      })
      const custody = fakeCustody({ internal: { cbInDecryption: { initiateAndWait } } })

      const output = await callTool(options(custody), 'decryptConfidentialInboxBalance', {
        accountId: 'account-1',
        ledgerId: 'ledger-1',
        issuanceId: 'ISSUANCE',
      })

      expect(output).toMatchObject({ requestId: 'req-2', status: 'Preparing', isTerminal: false })
    })
  })

  describe('getConfidentialInboxDecryption', () => {
    it('returns the status of a decryption request', async () => {
      const getStatus = vi.fn(async () => ({ id: 'req-1', status: 'Failed', error: 'no key' }))
      const custody = fakeCustody({ internal: { cbInDecryption: { getStatus } } })

      const output = await callTool(options(custody), 'getConfidentialInboxDecryption', { requestId: 'req-1' })

      expect(output).toEqual({
        environment: 'dev',
        requestId: 'req-1',
        status: 'Failed',
        decryptedAmount: undefined,
        error: 'no key',
      })
      expect(getStatus).toHaveBeenCalledWith({ requestId: 'req-1' })
    })
  })
})
