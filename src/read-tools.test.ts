import { CustodyError, UnsupportedInVersionError } from '@florent-uzio/custody'
import { describe, expect, it, vi } from 'vitest'
import type { CustodyClient } from './custody'
import { callTool, configFile, DEV, fakeCustody } from './testing'

/** What Custody signs and returns around every domain and account record. */
const signed = <Data>(data: Data) => ({ data, signature: 'SIG', signingKey: 'SIGNING KEY' })

const metadata = { createdAt: '2026-01-01T00:00:00Z', createdBy: { id: 'user-1' }, revision: 1 }

// One Environment with a Default domain; its key comes from an env var.
const options = (
  custody: CustodyClient,
  { defaultDomainId }: { defaultDomainId?: string } = { defaultDomainId: 'domain-1' },
) => ({
  env: {
    DEV_KEY: 'DEV KEY',
    CUSTODY_MCP_CONFIG: configFile({
      environments: { dev: { ...DEV, keyReference: 'env:DEV_KEY', defaultDomainId } },
    }),
  },
  connect: () => custody,
})

describe('read tools for domains and accounts', () => {
  describe('getBackendVersion', () => {
    it('returns the version of the Custody instance', async () => {
      const custody = fakeCustody({ backendVersion: async () => '2.8.1' })

      const output = await callTool(options(custody), 'getBackendVersion')

      expect(output).toEqual({ environment: 'dev', backendVersion: '2.8.1' })
    })
  })
  describe('listDomains', () => {
    const domainsPage = {
      count: 1,
      nextStartingAfter: 'domain-2',
      items: [
        signed({
          id: 'domain-2',
          parentId: 'domain-1',
          alias: 'Treasury',
          lock: 'Unlocked',
          permissions: { readAccess: {} },
          metadata,
        }),
      ],
    }

    it('returns a compact summary of each domain and the cursor of the next page', async () => {
      const list = vi.fn(async () => domainsPage)

      const output = await callTool(options(fakeCustody({ domains: { list } })), 'listDomains')

      expect(output).toEqual({
        environment: 'dev',
        domains: [{ id: 'domain-2', alias: 'Treasury', parentId: 'domain-1', lock: 'Unlocked' }],
        nextCursor: 'domain-2',
      })
      expect(list).toHaveBeenCalledWith({ limit: 20, startingAfter: undefined })
    })

    it('fetches the page after a cursor, with the limit asked for', async () => {
      const list = vi.fn(async () => ({ ...domainsPage, nextStartingAfter: undefined }))

      const output = await callTool(options(fakeCustody({ domains: { list } })), 'listDomains', {
        limit: 5,
        cursor: 'domain-2',
      })

      expect(list).toHaveBeenCalledWith({ limit: 5, startingAfter: 'domain-2' })
      expect(output).not.toHaveProperty('nextCursor')
    })

    it('refuses a page of more than 100 items without calling Custody', async () => {
      const list = vi.fn(async () => domainsPage)

      const output = await callTool(options(fakeCustody({ domains: { list } })), 'listDomains', { limit: 101 })

      expect(output).toEqual({ error: expect.stringContaining('limit') })
      expect(list).not.toHaveBeenCalled()
    })
  })
  describe('listAccounts', () => {
    const accountsPage = {
      count: 1,
      nextStartingAfter: 'account-1',
      items: [
        signed({
          id: 'account-1',
          domainId: 'domain-1',
          alias: 'Hot wallet',
          ledgerIds: ['xrpl-testnet'],
          providerDetails: { vaultId: 'vault-1', keyStrategy: 'VaultHard' },
          lock: 'Unlocked',
          metadata,
        }),
      ],
    }

    it('lists the accounts of the Default domain, compactly, with the next cursor', async () => {
      const list = vi.fn(async () => accountsPage)

      const output = await callTool(options(fakeCustody({ accounts: { list } })), 'listAccounts')

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        accounts: [{ id: 'account-1', alias: 'Hot wallet', ledgerIds: ['xrpl-testnet'], lock: 'Unlocked' }],
        nextCursor: 'account-1',
      })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 20, startingAfter: undefined })
    })

    it('lists the accounts of another domain when given a domainId', async () => {
      const list = vi.fn(async () => accountsPage)

      const output = await callTool(options(fakeCustody({ accounts: { list } })), 'listAccounts', {
        domainId: 'domain-9',
      })

      expect(output).toMatchObject({ domainId: 'domain-9' })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-9' }, expect.anything())
    })

    it("uses the user's only domain when the Environment has no Default domain", async () => {
      const list = vi.fn(async () => accountsPage)
      const me = async () => ({ domains: [{ id: 'domain-7', alias: 'Demo' }] })

      const output = await callTool(options(fakeCustody({ accounts: { list }, users: { me } }), {}), 'listAccounts')

      expect(output).toMatchObject({ domainId: 'domain-7' })
    })

    it('asks for a domainId when the Environment has no Default domain and the user has several', async () => {
      const me = async () => ({
        domains: [
          { id: 'domain-1', alias: 'Demo' },
          { id: 'domain-2', alias: 'Treasury' },
        ],
      })

      const output = await callTool(options(fakeCustody({ users: { me } }), {}), 'listAccounts')

      expect(output).toEqual({
        error:
          'Environment "dev" has no Default domain and its user belongs to several domains: Demo (domain-1), Treasury (domain-2). Pass a domainId.',
      })
    })
  })
  describe('getAccount', () => {
    const account = {
      id: 'account-1',
      domainId: 'domain-1',
      alias: 'Hot wallet',
      ledgerIds: ['xrpl-testnet'],
      providerDetails: { vaultId: 'vault-1', keyStrategy: 'VaultHard' },
      lock: 'Unlocked',
      metadata,
    }
    const additionalDetails = { processing: { status: 'Ready' }, ledgers: [] }

    it('returns the account and its processing details, without the signature envelope', async () => {
      const get = vi.fn(async () => ({ ...signed(account), additionalDetails }))

      const output = await callTool(options(fakeCustody({ accounts: { get } })), 'getAccount', {
        accountId: 'account-1',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-1', account, additionalDetails })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-1', accountId: 'account-1' })
    })
  })
  describe('listAccountAddresses', () => {
    it('lists the addresses of an account on each ledger, compactly, with the next cursor', async () => {
      const addresses = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'address-1',
        items: [
          {
            id: 'address-1',
            ledgerId: 'xrpl-testnet',
            address: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
            keyPath: "m/44'/144'/0'/0/0",
            signature: 'SIG',
            signingKey: 'SIGNING KEY',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'Internal',
            data: { type: 'Account' },
          },
        ],
      }))

      const output = await callTool(options(fakeCustody({ accounts: { addresses } })), 'listAccountAddresses', {
        accountId: 'account-1',
        limit: 5,
        cursor: 'address-0',
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        accountId: 'account-1',
        addresses: [
          {
            id: 'address-1',
            ledgerId: 'xrpl-testnet',
            address: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
            scope: 'Internal',
          },
        ],
        nextCursor: 'address-1',
      })
      expect(addresses).toHaveBeenCalledWith(
        { domainId: 'domain-1', accountId: 'account-1' },
        { limit: 5, startingAfter: 'address-0' },
      )
    })
  })

  describe('getAccountBalances', () => {
    it('lists the balance of each ticker of an account, compactly, with the next cursor', async () => {
      const getAccountBalances = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'balance-1',
        items: [
          {
            accountReference: { id: 'account-1', domainId: 'domain-1' },
            tickerId: 'ticker-xrp',
            totalAmount: '100',
            reservedAmount: '10',
            quarantinedAmount: '0',
            availableAmount: '90',
            lastUpdatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      }))

      const output = await callTool(options(fakeCustody({ accounts: { getAccountBalances } })), 'getAccountBalances', {
        accountId: 'account-1',
        domainId: 'domain-9',
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-9',
        accountId: 'account-1',
        balances: [
          {
            tickerId: 'ticker-xrp',
            totalAmount: '100',
            availableAmount: '90',
            reservedAmount: '10',
            quarantinedAmount: '0',
            lastUpdatedAt: '2026-01-02T00:00:00Z',
          },
        ],
        nextCursor: 'balance-1',
      })
      expect(getAccountBalances).toHaveBeenCalledWith(
        { domainId: 'domain-9', accountId: 'account-1' },
        { limit: 20, startingAfter: undefined },
      )
    })
  })
  describe('findAccountByAddress', () => {
    const ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'

    it('finds the Custody account behind a ledger address, across domains', async () => {
      const findByAddress = vi.fn(async () => ({
        id: 'address-1',
        address: ADDRESS,
        ledgerId: 'xrpl-testnet',
        domainId: 'domain-3',
        accountId: 'account-1',
        createdAt: '2026-01-01T00:00:00Z',
        custodyType: 'Custodial',
        type: 'AccountAddressReference',
      }))

      const output = await callTool(options(fakeCustody({ accounts: { findByAddress } })), 'findAccountByAddress', {
        address: ADDRESS,
      })

      expect(output).toEqual({
        environment: 'dev',
        account: { domainId: 'domain-3', accountId: 'account-1', ledgerId: 'xrpl-testnet', address: ADDRESS },
      })
      expect(findByAddress).toHaveBeenCalledWith(ADDRESS, { ledgerId: undefined, domainId: undefined })
    })

    it('narrows the search to a ledger and a domain when given them', async () => {
      const findByAddress = vi.fn(async () => undefined)

      await callTool(options(fakeCustody({ accounts: { findByAddress } })), 'findAccountByAddress', {
        address: ADDRESS,
        ledgerId: 'xrpl-testnet',
        domainId: 'domain-3',
      })

      expect(findByAddress).toHaveBeenCalledWith(ADDRESS, { ledgerId: 'xrpl-testnet', domainId: 'domain-3' })
    })

    it('says when no Custody account has the address', async () => {
      const findByAddress = async () => undefined

      const output = await callTool(options(fakeCustody({ accounts: { findByAddress } })), 'findAccountByAddress', {
        address: ADDRESS,
      })

      expect(output).toEqual({ environment: 'dev', account: null })
    })
  })
  describe('errors', () => {
    it('names the backend version when the Custody instance is too old for a call', async () => {
      const getAccountBalances = async () => {
        throw new UnsupportedInVersionError({
          capability: 'GET /v1/domains/{domainId}/accounts/{accountId}/balances',
          kind: 'endpoint',
          appVersion: '1.9.0',
          sdkMethod: 'accounts.getAccountBalances',
        })
      }

      const output = await callTool(options(fakeCustody({ accounts: { getAccountBalances } })), 'getAccountBalances', {
        accountId: 'account-1',
      })

      expect(output).toEqual({ error: expect.stringContaining('backend version 1.9.0') })
    })

    it("passes on Custody's reason for refusing a call", async () => {
      const get = async () => {
        throw new CustodyError({ reason: 'Account account-404 not found' }, 404)
      }

      const output = await callTool(options(fakeCustody({ accounts: { get } })), 'getAccount', {
        accountId: 'account-404',
      })

      expect(output).toEqual({ error: 'Account account-404 not found' })
    })
  })
})
