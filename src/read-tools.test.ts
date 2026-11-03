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

describe('read tools for Intents, transfers, transactions and reference data', () => {
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
  const transfer = {
    id: 'transfer-1',
    transactionId: 'transaction-1',
    tickerId: 'ticker-xrp',
    quarantined: false,
    quarantineStatus: 'Skipped',
    senders: [{ domainId: 'domain-1', accountId: 'account-1', type: 'Account' }],
    recipient: { address: 'rBOB', addressDetails: { address: 'rBOB' }, type: 'Address' },
    value: '10000000',
    kind: 'Transfer',
    registeredAt: '2026-01-01T00:02:00Z',
    metadata: { ledgerData: { type: 'XRPL' } },
  }

  describe('listTransfers', () => {
    it('lists the transfers of the Default domain, compactly, with the next cursor', async () => {
      const transfers = vi.fn(async () => ({ count: 1, nextStartingAfter: 'transfer-1', items: [transfer] }))

      const output = await callTool(options(fakeCustody({ transactions: { transfers } })), 'listTransfers')

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transfers: [
          {
            id: 'transfer-1',
            kind: 'Transfer',
            tickerId: 'ticker-xrp',
            value: '10000000',
            senders: [{ domainId: 'domain-1', accountId: 'account-1', type: 'Account' }],
            recipient: { address: 'rBOB', addressDetails: { address: 'rBOB' }, type: 'Address' },
            transactionId: 'transaction-1',
            quarantineStatus: 'Skipped',
            registeredAt: '2026-01-01T00:02:00Z',
          },
        ],
        nextCursor: 'transfer-1',
      })
      expect(transfers).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 20, startingAfter: undefined })
    })

    it('narrows the list to the transfers of one account in another domain', async () => {
      const transfers = vi.fn(async () => ({ count: 0, items: [] }))

      const output = await callTool(options(fakeCustody({ transactions: { transfers } })), 'listTransfers', {
        domainId: 'domain-9',
        accountId: 'account-1',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-9', transfers: [] })
      expect(transfers).toHaveBeenCalledWith(
        { domainId: 'domain-9' },
        { limit: 20, startingAfter: undefined, accountId: 'account-1' },
      )
    })
  })
  describe('getTransfer', () => {
    it('returns one transfer in full', async () => {
      const get = vi.fn(async () => transfer)

      const output = await callTool(options(fakeCustody({ transactions: { transfer: get } })), 'getTransfer', {
        transferId: 'transfer-1',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-1', transfer })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-1', transferId: 'transfer-1' })
    })
  })
  describe('listTransactionOrders', () => {
    const order = signed({
      id: 'order-1',
      domainId: 'domain-1',
      accountId: 'account-1',
      ledgerId: 'xrpl-testnet',
      parameters: { type: 'XRPL', operation: { type: 'Payment', amount: '10000000' } },
      metadata,
    })

    it('lists the transaction orders an Intent produced, compactly, with the next cursor', async () => {
      const orders = vi.fn(async () => ({ count: 1, nextStartingAfter: 'order-1', items: [order] }))

      const output = await callTool(options(fakeCustody({ transactions: { orders } })), 'listTransactionOrders', {
        intentId: 'intent-1',
      })

      expect(output).toEqual({
        environment: 'dev',
        domainId: 'domain-1',
        transactionOrders: [
          {
            id: 'order-1',
            accountId: 'account-1',
            ledgerId: 'xrpl-testnet',
            type: 'XRPL',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        nextCursor: 'order-1',
      })
      expect(orders).toHaveBeenCalledWith(
        { domainId: 'domain-1' },
        { limit: 20, startingAfter: undefined, intentId: 'intent-1' },
      )
    })

    it('lists every transaction order of the domain when given no Intent', async () => {
      const orders = vi.fn(async () => ({ count: 0, items: [] }))

      await callTool(options(fakeCustody({ transactions: { orders } })), 'listTransactionOrders', { limit: 3 })

      expect(orders).toHaveBeenCalledWith({ domainId: 'domain-1' }, { limit: 3, startingAfter: undefined })
    })
  })
  describe('getTransaction', () => {
    it('returns one transaction in full, with its processing and ledger status', async () => {
      const transaction = {
        id: 'transaction-1',
        ledgerId: 'xrpl-testnet',
        orderReference: { id: 'order-1', domainId: 'domain-1' },
        relatedAccounts: [{ domainId: 'domain-1', accountId: 'account-1' }],
        processing: { status: 'Completed' },
        registeredAt: '2026-01-01T00:02:00Z',
        ledgerTransactionData: {
          ledgerStatus: 'Confirmed',
          ledgerTransactionId: 'ABC123',
          statusLastUpdatedAt: '2026-01-01T00:03:00Z',
        },
        relatedTransactions: [],
      }
      const get = vi.fn(async () => transaction)

      const output = await callTool(options(fakeCustody({ transactions: { transaction: get } })), 'getTransaction', {
        transactionId: 'transaction-1',
        domainId: 'domain-9',
      })

      expect(output).toEqual({ environment: 'dev', domainId: 'domain-9', transaction })
      expect(get).toHaveBeenCalledWith({ domainId: 'domain-9', transactionId: 'transaction-1' })
    })
  })
  describe('listTickers', () => {
    it('lists the tickers of the Custody instance, compactly, with the next cursor', async () => {
      const data = {
        id: 'ticker-xrp',
        ledgerId: 'xrpl-testnet',
        kind: 'Native',
        name: 'XRP',
        decimals: 6,
        symbol: 'XRP',
        ledgerDetails: { type: 'XRPL', properties: { type: 'Native' } },
        lock: 'Unlocked',
        metadata,
      }
      // Custody repeats the ticker's fields at the top level, deprecated, around the signed data.
      const list = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'ticker-xrp',
        items: [{ id: 'ticker-xrp', name: 'XRP (deprecated copy)', data, signature: 'SIG' }],
      }))

      const output = await callTool(options(fakeCustody({ tickers: { list } })), 'listTickers', {
        limit: 50,
        cursor: 'ticker-btc',
      })

      expect(output).toEqual({
        environment: 'dev',
        tickers: [
          {
            id: 'ticker-xrp',
            ledgerId: 'xrpl-testnet',
            kind: 'Native',
            name: 'XRP',
            symbol: 'XRP',
            decimals: 6,
            lock: 'Unlocked',
          },
        ],
        nextCursor: 'ticker-xrp',
      })
      expect(list).toHaveBeenCalledWith({ limit: 50, startingAfter: 'ticker-btc' })
    })
  })
  describe('listLedgers', () => {
    it('lists the ledgers of the Custody instance, compactly, with the next cursor', async () => {
      const list = vi.fn(async () => ({
        count: 1,
        nextStartingAfter: 'xrpl-testnet',
        items: [
          signed({
            id: 'xrpl-testnet',
            alias: 'XRPL Testnet',
            parameters: { type: 'XRPL', nativeTickerSymbol: 'XRP', nativeTickerName: 'XRP', networkId: 1 },
            metadata,
          }),
        ],
      }))

      const output = await callTool(options(fakeCustody({ ledgers: { list } })), 'listLedgers')

      expect(output).toEqual({
        environment: 'dev',
        ledgers: [{ id: 'xrpl-testnet', alias: 'XRPL Testnet', type: 'XRPL' }],
        nextCursor: 'xrpl-testnet',
      })
      expect(list).toHaveBeenCalledWith({ limit: 20, startingAfter: undefined })
    })
  })
})
