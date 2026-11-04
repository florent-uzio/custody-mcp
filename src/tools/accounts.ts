import { z } from 'zod'
import type { DefineCustodyTool } from './define'
import { explorerUrlField } from './explorer-links'

const accountInput = { accountId: z.string().describe('Id of the Custody account (see listAccounts).') }

/** Read tools for the domains, users and accounts of an Environment's Custody user. */
export const createAccountTools = (defineCustodyTool: DefineCustodyTool) => ({
  getMe: defineCustodyTool({
    id: 'getMe',
    description:
      'Get the Custody user this Environment acts as: its public key and, for each domain it belongs to, the user id, alias and roles.',
    input: {},
    run: async ({ custody }) => ({ me: await custody.users.me() }),
  }),

  listDomains: defineCustodyTool({
    id: 'listDomains',
    description: 'List the Custody domains this Environment can see, one page at a time.',
    paged: true,
    input: {},
    run: async ({ custody, pageQuery }) => {
      const page = await custody.domains.list(pageQuery)
      return {
        domains: page.items.map(({ data }) => ({
          id: data.id,
          alias: data.alias,
          parentId: data.parentId,
          lock: data.lock,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  listUsers: defineCustodyTool({
    id: 'listUsers',
    description:
      "List the users of a Custody domain, one page at a time, with their id, alias, public key, roles and login ids. getMe only returns the Environment's own user.",
    domain: true,
    paged: true,
    input: {},
    run: async ({ custody, domainId, pageQuery }) => {
      const page = await custody.users.list({ domainId }, pageQuery)
      return {
        users: page.items.map(({ data }) => ({
          id: data.id,
          alias: data.alias,
          publicKey: data.publicKey,
          roles: data.roles,
          loginIds: data.loginIds,
          lock: data.lock,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  listAccounts: defineCustodyTool({
    id: 'listAccounts',
    description: 'List the accounts of a Custody domain, one page at a time.',
    domain: true,
    paged: true,
    input: {},
    run: async ({ custody, domainId, pageQuery }) => {
      const page = await custody.accounts.list({ domainId }, pageQuery)
      return {
        accounts: page.items.map(({ data }) => ({
          id: data.id,
          alias: data.alias,
          ledgerIds: data.ledgerIds ?? (data.ledgerId === undefined ? [] : [data.ledgerId]),
          lock: data.lock,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  getAccount: defineCustodyTool({
    id: 'getAccount',
    description: 'Get one account of a Custody domain, with its ledgers and processing status.',
    domain: true,
    input: accountInput,
    run: async ({ custody, domainId, input }) => {
      const { data, additionalDetails } = await custody.accounts.get({ domainId, accountId: input.accountId })
      return { account: data, additionalDetails }
    },
  }),

  listAccountAddresses: defineCustodyTool({
    id: 'listAccountAddresses',
    description: 'List the ledger addresses of a Custody account, one page at a time.',
    domain: true,
    paged: true,
    input: accountInput,
    run: async ({ custody, domainId, input: { accountId }, pageQuery, explorer }) => {
      const page = await custody.accounts.addresses({ domainId, accountId }, pageQuery)
      return {
        accountId,
        addresses: await Promise.all(
          page.items.map(async item => ({
            id: item.id,
            ledgerId: item.ledgerId,
            address: item.address,
            scope: item.scope,
            ...explorerUrlField(await explorer.address(item.ledgerId, item.address)),
          })),
        ),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  getAccountBalances: defineCustodyTool({
    id: 'getAccountBalances',
    description: 'List the balances of a Custody account, one ticker per item, one page at a time.',
    domain: true,
    paged: true,
    input: accountInput,
    run: async ({ custody, domainId, input: { accountId }, pageQuery }) => {
      const page = await custody.accounts.getAccountBalances({ domainId, accountId }, pageQuery)
      return {
        accountId,
        balances: page.items.map(item => ({
          tickerId: item.tickerId,
          totalAmount: item.totalAmount,
          availableAmount: item.availableAmount,
          reservedAmount: item.reservedAmount,
          quarantinedAmount: item.quarantinedAmount,
          lastUpdatedAt: item.lastUpdatedAt,
        })),
        nextCursor: page.nextStartingAfter,
      }
    },
  }),

  // Not domain-scoped: an address can belong to any domain, so the Default domain does not apply.
  findAccountByAddress: defineCustodyTool({
    id: 'findAccountByAddress',
    description:
      'Find the Custody account that owns a ledger address, in any domain. Returns account null when no account has it.',
    input: {
      address: z.string().describe('The ledger address, as shown on the ledger.'),
      ledgerId: z.string().optional().describe('Id of the ledger, when the address is on several.'),
      domainId: z.string().optional().describe('Id of the domain to look in, when the address is in several.'),
    },
    run: async ({ custody, input, explorer }) => {
      const found = await custody.accounts.findByAddress(input.address, {
        ledgerId: input.ledgerId,
        domainId: input.domainId,
      })
      return {
        account:
          found === undefined
            ? null
            : {
                domainId: found.domainId,
                accountId: found.accountId,
                ledgerId: found.ledgerId,
                address: found.address,
                ...explorerUrlField(await explorer.address(found.ledgerId, found.address)),
              },
      }
    },
  }),
})
