import { z } from 'zod'
import { domainIdFor, domainInput, type DefineCustodyTool } from './custody-tool'

const accountInput = { accountId: z.string().describe('Id of the Custody account (see listAccounts).') }

const pageInput = {
  limit: z.number().int().min(1).max(100).default(20).describe('How many items to return (default 20, at most 100).'),
  cursor: z.string().optional().describe('The nextCursor of the previous page, to get the page after it.'),
}

type Page = { nextStartingAfter?: string }

const pageQuery = ({ limit, cursor }: { limit: number; cursor?: string }) => ({ limit, startingAfter: cursor })

// Omitted on the last page, so the model has no cursor to follow.
const nextCursor = (page: Page) => (page.nextStartingAfter === undefined ? {} : { nextCursor: page.nextStartingAfter })

/** Read tools for the domains and accounts of an Environment's Custody user. */
export const createAccountTools = (defineCustodyTool: DefineCustodyTool) => ({
  listDomains: defineCustodyTool({
    id: 'listDomains',
    description: 'List the Custody domains this Environment can see, one page at a time.',
    input: pageInput,
    run: async ({ custody, input }) => {
      const page = await custody.domains.list(pageQuery(input))
      return {
        domains: page.items.map(({ data }) => ({
          id: data.id,
          alias: data.alias,
          parentId: data.parentId,
          lock: data.lock,
        })),
        ...nextCursor(page),
      }
    },
  }),

  listAccounts: defineCustodyTool({
    id: 'listAccounts',
    description: 'List the accounts of a Custody domain, one page at a time.',
    input: { ...domainInput, ...pageInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const page = await args.custody.accounts.list({ domainId }, pageQuery(args.input))
      return {
        domainId,
        accounts: page.items.map(({ data }) => ({
          id: data.id,
          alias: data.alias,
          ledgerIds: data.ledgerIds ?? (data.ledgerId === undefined ? [] : [data.ledgerId]),
          lock: data.lock,
        })),
        ...nextCursor(page),
      }
    },
  }),

  getAccount: defineCustodyTool({
    id: 'getAccount',
    description: 'Get one account of a Custody domain, with its ledgers and processing status.',
    input: { ...domainInput, ...accountInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { data, additionalDetails } = await args.custody.accounts.get({ domainId, accountId: args.input.accountId })
      return { domainId, account: data, additionalDetails }
    },
  }),

  listAccountAddresses: defineCustodyTool({
    id: 'listAccountAddresses',
    description: 'List the ledger addresses of a Custody account, one page at a time.',
    input: { ...domainInput, ...accountInput, ...pageInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { accountId } = args.input
      const page = await args.custody.accounts.addresses({ domainId, accountId }, pageQuery(args.input))
      return {
        domainId,
        accountId,
        addresses: page.items.map(item => ({
          id: item.id,
          ledgerId: item.ledgerId,
          address: item.address,
          scope: item.scope,
        })),
        ...nextCursor(page),
      }
    },
  }),

  getAccountBalances: defineCustodyTool({
    id: 'getAccountBalances',
    description: 'List the balances of a Custody account, one ticker per item, one page at a time.',
    input: { ...domainInput, ...accountInput, ...pageInput },
    run: async args => {
      const domainId = await domainIdFor(args)
      const { accountId } = args.input
      const page = await args.custody.accounts.getAccountBalances({ domainId, accountId }, pageQuery(args.input))
      return {
        domainId,
        accountId,
        balances: page.items.map(item => ({
          tickerId: item.tickerId,
          totalAmount: item.totalAmount,
          availableAmount: item.availableAmount,
          reservedAmount: item.reservedAmount,
          quarantinedAmount: item.quarantinedAmount,
          lastUpdatedAt: item.lastUpdatedAt,
        })),
        ...nextCursor(page),
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
    run: async ({ custody, input }) => {
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
              },
      }
    },
  }),
})
