import { CustodyError, UnsupportedInVersionError } from '@florent-uzio/custody'
import { describe, expect, it, vi } from 'vitest'
import { callTool, devServerOptions, fakeCustody, recordMetadata, signed } from '../testing'

describe('read tools for domains and accounts', () => {
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
          metadata: recordMetadata,
        }),
      ],
    }

    it('returns a compact summary of each domain and the cursor of the next page', async () => {
      const list = vi.fn(async () => domainsPage)

      const output = await callTool(devServerOptions(fakeCustody({ domains: { list } })), 'listDomains')

      expect(output).toEqual({
        environment: 'dev',
        domains: [{ id: 'domain-2', alias: 'Treasury', parentId: 'domain-1', lock: 'Unlocked' }],
        nextCursor: 'domain-2',
      })
      expect(list).toHaveBeenCalledWith({ limit: 20, startingAfter: undefined })
    })

    it('fetches the page after a cursor, with the limit asked for', async () => {
      const list = vi.fn(async () => ({ ...domainsPage, nextStartingAfter: undefined }))

      const output = await callTool(devServerOptions(fakeCustody({ domains: { list } })), 'listDomains', {
        limit: 5,
        cursor: 'domain-2',
      })

      expect(list).toHaveBeenCalledWith({ limit: 5, startingAfter: 'domain-2' })
      expect(output).not.toHaveProperty('nextCursor')
    })

    it('refuses a page of more than 100 items without calling Custody', async () => {
      const list = vi.fn(async () => domainsPage)

      const output = await callTool(devServerOptions(fakeCustody({ domains: { list } })), 'listDomains', { limit: 101 })

      expect(output).toEqual({ error: expect.stringContaining('limit') })
      expect(list).not.toHaveBeenCalled()
    })
  })
  describe('listUsers', () => {
    const usersPage = {
      count: 1,
      nextStartingAfter: 'user-1',
      items: [
        signed({
          id: 'user-1',
          domainId: 'domain-1',
          alias: 'alice',
          publicKey: 'PUBLIC KEY',
          roles: ['admin'],
          loginIds: [{ id: 'alice@example.com', providerId: 'sso' }],
          lock: 'Unlocked',
          metadata: recordMetadata,
        }),
      ],
    }

    it('lists the users of the Default domain, compactly, with the next cursor', async () => {
      const list = vi.fn(async () => usersPage)

      const output = await callTool(devServerOptions(fakeCustody({ users: { list } })), 'listUsers')

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        users: [
          {
            id: 'user-1',
            alias: 'alice',
            publicKey: 'PUBLIC KEY',
            roles: ['admin'],
            loginIds: [{ id: 'alice@example.com', providerId: 'sso' }],
            lock: 'Unlocked',
          },
        ],
        nextCursor: 'user-1',
      })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 20, startingAfter: undefined })
    })

    it('lists the users of another domain when given a domainId', async () => {
      const list = vi.fn(async () => usersPage)

      const output = await callTool(devServerOptions(fakeCustody({ users: { list } })), 'listUsers', {
        domainId: 'domain-9',
      })

      expect(output).toMatchObject({ domainId: 'domain-9' })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-9' }, expect.anything())
    })

    it("passes on Custody's reason for refusing to list users", async () => {
      const list = async () => {
        throw new CustodyError({ reason: 'Missing permission to list users' }, 403)
      }

      const output = await callTool(devServerOptions(fakeCustody({ users: { list } })), 'listUsers')

      expect(output).toEqual({ error: 'Missing permission to list users' })
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
          metadata: recordMetadata,
        }),
      ],
    }

    it('lists the accounts of the Default domain, compactly, with the next cursor', async () => {
      const list = vi.fn(async () => accountsPage)

      const output = await callTool(devServerOptions(fakeCustody({ accounts: { list } })), 'listAccounts')

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

      const output = await callTool(devServerOptions(fakeCustody({ accounts: { list } })), 'listAccounts', {
        domainId: 'domain-9',
      })

      expect(output).toMatchObject({ domainId: 'domain-9' })
      expect(list).toHaveBeenCalledWith({ domainId: 'domain-9' }, expect.anything())
    })

    it("uses the user's only domain when the Environment has no Default domain", async () => {
      const list = vi.fn(async () => accountsPage)
      const me = async () => ({ domains: [{ id: 'domain-7', alias: 'Demo' }] })

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { list }, users: { me } }), {}),
        'listAccounts',
      )

      expect(output).toMatchObject({ domainId: 'domain-7' })
    })

    it('asks for a domainId when the Environment has no Default domain and the user has several', async () => {
      const me = async () => ({
        domains: [
          { id: 'domain-1', alias: 'Demo' },
          { id: 'domain-2', alias: 'Treasury' },
        ],
      })

      const output = await callTool(devServerOptions(fakeCustody({ users: { me } }), {}), 'listAccounts')

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
      metadata: recordMetadata,
    }
    const additionalDetails = { processing: { status: 'Ready' }, ledgers: [] }

    it('returns the account and its processing details, without the signature envelope', async () => {
      const get = vi.fn(async () => ({ ...signed(account), additionalDetails }))

      const output = await callTool(devServerOptions(fakeCustody({ accounts: { get } })), 'getAccount', {
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

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { addresses } })),
        'listAccountAddresses',
        {
          accountId: 'account-1',
          limit: 5,
          cursor: 'address-0',
        },
      )

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

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { getAccountBalances } })),
        'getAccountBalances',
        {
          accountId: 'account-1',
          domainId: 'domain-9',
        },
      )

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

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { findByAddress } })),
        'findAccountByAddress',
        {
          address: ADDRESS,
        },
      )

      expect(output).toEqual({
        environment: 'dev',
        account: { domainId: 'domain-3', accountId: 'account-1', ledgerId: 'xrpl-testnet', address: ADDRESS },
      })
      expect(findByAddress).toHaveBeenCalledWith(ADDRESS, { ledgerId: undefined, domainId: undefined })
    })

    it('narrows the search to a ledger and a domain when given them', async () => {
      const findByAddress = vi.fn(async () => undefined)

      await callTool(devServerOptions(fakeCustody({ accounts: { findByAddress } })), 'findAccountByAddress', {
        address: ADDRESS,
        ledgerId: 'xrpl-testnet',
        domainId: 'domain-3',
      })

      expect(findByAddress).toHaveBeenCalledWith(ADDRESS, { ledgerId: 'xrpl-testnet', domainId: 'domain-3' })
    })

    it('says when no Custody account has the address', async () => {
      const findByAddress = async () => undefined

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { findByAddress } })),
        'findAccountByAddress',
        {
          address: ADDRESS,
        },
      )

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

      const output = await callTool(
        devServerOptions(fakeCustody({ accounts: { getAccountBalances } })),
        'getAccountBalances',
        {
          accountId: 'account-1',
        },
      )

      expect(output).toEqual({ error: expect.stringContaining('backend version 1.9.0') })
    })

    it("passes on Custody's reason for refusing a call", async () => {
      const get = async () => {
        throw new CustodyError({ reason: 'Account account-404 not found' }, 404)
      }

      const output = await callTool(devServerOptions(fakeCustody({ accounts: { get } })), 'getAccount', {
        accountId: 'account-404',
      })

      expect(output).toEqual({ error: 'Account account-404 not found' })
    })
  })
})
