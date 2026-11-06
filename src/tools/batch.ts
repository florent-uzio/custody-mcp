import { batchToCustodyInnerTransactions, type BatchPayloadInput, type Core_BatchSigner } from '@florent-uzio/custody'
import { z } from 'zod'
import type { DefineCustodyTool } from './define'
import { batchXrplOperation, sponsorship } from './xrpl-operation'

// The XLS-56 Batch flow under Batch v1.1, in three steps: dry-run the Batch to get one `signers[]` entry per
// inner signer, have each signer sign its own entry, then propose the Batch with the signatures.

const participant = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Account'), accountId: z.string() }),
    z.object({ type: z.literal('Address'), address: z.string() }),
    z.object({ type: z.literal('Endpoint'), endpointId: z.string() }),
  ])
  .describe('A Batch participant, exactly as `dryRunBatchIntent` returns it.')

const ledgerSequence = z.number().int()

const submitterSequencing = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PlatformManaged') }),
  z.object({ type: z.literal('AccountSequence'), value: ledgerSequence }),
  z.object({ type: z.literal('Ticket'), value: ledgerSequence }),
])

const participantSequencing = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AccountSequence'), value: ledgerSequence }),
  z.object({ type: z.literal('Ticket'), value: ledgerSequence }),
])

const submitterEntry = z.object({
  type: z.literal('SubmitterOperation'),
  operation: batchXrplOperation,
  sequencing: submitterSequencing,
  sponsorship: sponsorship.optional(),
})

const participantEntry = z.object({
  type: z.literal('ParticipantOperation'),
  participant,
  operation: batchXrplOperation,
  sequencing: participantSequencing,
  sponsorship: sponsorship.optional(),
})

const batchInput = {
  account: z.string().describe('XRPL address of the submitter: the Custody account that pays the outer Batch fee.'),
  ledgerId: z.string().optional().describe('Id of the ledger, when the address is on several.'),
  executionMode: z
    .enum(['AllOrNothing', 'OnlyOne', 'UntilFailure', 'Independent'])
    .describe('How the ledger handles an inner transaction that fails.'),
  entries: z
    .array(z.discriminatedUnion('type', [submitterEntry, participantEntry]))
    .min(1)
    .describe(
      'The inner transactions: `SubmitterOperation` (sent by the submitter) or `ParticipantOperation` (sent by another account, which must sign).',
    ),
  sequencing: submitterSequencing
    .optional()
    .describe('Sequencing of the outer Batch. Defaults to PlatformManaged; entries must then be consistent with it.'),
  lastLedgerSequence: ledgerSequence.optional().describe('Last ledger sequence of the outer Batch.'),
  sponsorship: sponsorship.optional(),
  description: z.string().optional().describe('A human-readable description of the Intent, shown to approvers.'),
}

type BatchArgs = z.infer<z.ZodObject<typeof batchInput>>

/** custody.js's Batch payload and its options, from the tool input. */
const batchParams = (input: BatchArgs, domainId: string) => {
  const { account, entries, executionMode, sequencing, lastLedgerSequence, sponsorship, ledgerId, description } = input
  const payload = {
    Account: account,
    executionMode,
    // The entries are checked above; custody.js's own types are looser about `operation` than zod infers.
    entries: entries as unknown as BatchPayloadInput['entries'],
    ...(sequencing === undefined ? {} : { sequencing }),
    ...(lastLedgerSequence === undefined ? {} : { lastLedgerSequence }),
    ...(sponsorship === undefined ? {} : { sponsorship }),
  } satisfies BatchPayloadInput
  return { payload, options: { domainId, ledgerId, description } }
}

const signerInput = z.object({
  participant,
  account: z.string().describe('XRPL address of the signer.'),
  signingPayload: z.string().describe('Hex encoded signing payload of this signer.'),
  signingPayloadHash: z.string().describe('Hex encoded hash of the signing payload.'),
})

/** The tools of the Batch flow. */
export const createBatchTools = (defineCustodyTool: DefineCustodyTool) => ({
  // A read: it has Custody compute proofs for the sender's vault-held key, and proposes nothing.
  buildConfidentialSendLeg: defineCustodyTool({
    id: 'buildConfidentialSendLeg',
    description:
      "Build a ConfidentialMPTSend for a Batch entry: Custody computes its proofs with the sender's vault-held key (this can take a minute or two). Returns the `operation` to paste unchanged into the Batch entry, whose `sequencing` must be the same `Ticket` as `ticketSequence` (the proofs are bound to it, so the Ticket must already exist). Compute it once and reuse it in dryRunBatchIntent, signBatchSigner and proposeBatchIntent: computing it again gives different proofs and invalidates the signatures. The sender must be an account on this Custody instance.",
    domain: true,
    input: {
      sender: z.string().describe('XRPL address of the sending account, managed by this Custody instance.'),
      destination: z.string().describe('XRPL address of the receiving account.'),
      issuanceId: z.string().describe('The 192-bit MPT issuance id, hex encoded.'),
      amount: z.string().describe("Amount to send, in the token's smallest unit."),
      ticketSequence: ledgerSequence
        .optional()
        .describe('Ticket the entry is sequenced with. Omit only for an entry sequenced by AccountSequence.'),
      ledgerId: z.string().optional().describe('Id of the ledger, when the sender address is on several.'),
    },
    run: async args => {
      const { ledgerId, ...params } = args.input
      const leg = await args.custody.xrpl.buildConfidentialSend(params, { domainId: args.domainId, ledgerId })
      // custody.js's own conversion turns the leg into the entry's operation, so the encodings match what it expects.
      const [entry] = batchToCustodyInnerTransactions(
        { Account: params.sender, RawTransactions: [{ RawTransaction: leg.transaction }] } as Parameters<
          typeof batchToCustodyInnerTransactions
        >[0],
        { confidentialSends: { [params.sender]: leg.entryFields } },
      )
      return { operation: entry.operation }
    },
  }),

  // A read: the Dry run is unsigned and changes nothing in Custody.
  dryRunBatchIntent: defineCustodyTool({
    id: 'dryRunBatchIntent',
    description:
      'Step 1 of a Batch (XLS-56, Batch v1.1): Dry run a Batch from a Custody account without proposing anything. Returns `signers`: one entry per account that must sign, each with its own signing payload. Sign the entries of accounts on this Custody instance with signBatchSigner, then propose the Batch with proposeBatchIntent.',
    domain: true,
    input: batchInput,
    run: async args => {
      const { payload, options } = batchParams(args.input, args.domainId)
      // The top-level signing payload is deprecated and cannot be signed under Batch v1.1: left out.
      const { executionMode, transactions, signers } = await args.custody.xrpl.dryRunBatch(payload, options)
      return { executionMode, transactions, signers }
    },
  }),

  signBatchSigner: defineCustodyTool({
    id: 'signBatchSigner',
    description:
      'Step 2 of a Batch: propose the signing of one `signers` entry returned by dryRunBatchIntent, for an inner account managed by this Custody instance. Returns at once: the signature is only available once the signing Intent is approved (follow it with waitForIntent, then read it with getBatchSignature). Call it once per signer, passing the entry unchanged.',
    access: 'propose',
    domain: true,
    input: {
      signer: signerInput.describe('One entry of `signers` from dryRunBatchIntent, unchanged.'),
      ledgerId: z.string().optional().describe('Id of the ledger, when the signer address is on several.'),
      description: z.string().optional().describe('A human-readable description of the Intent, shown to approvers.'),
    },
    run: async args => {
      const { signer, ledgerId, description } = args.input
      const { intentResponse, ...handle } = await args.custody.xrpl.signBatchPayload(signer, {
        domainId: args.domainId,
        ledgerId,
        description,
      } as Parameters<typeof args.custody.xrpl.signBatchPayload>[1])
      return {
        intentId: intentResponse.requestId,
        ...handle,
        note: 'Keep payloadId, accountId, signerAddress, participant and signingPubKey: getBatchSignature needs them. Do not sign this entry again.',
      }
    },
  }),

  // A read: it fetches a signature that already exists.
  getBatchSignature: defineCustodyTool({
    id: 'getBatchSignature',
    description:
      'Read the signature of a signBatchSigner Intent, from the fields it returned. If its Intent is not approved yet it says so; that is not an error. A signed result gives the `batchSigner` to pass to proposeBatchIntent.',
    domain: true,
    input: {
      payloadId: z.string().describe('`payloadId` returned by signBatchSigner.'),
      accountId: z.string().describe('`accountId` returned by signBatchSigner.'),
      signerAddress: z.string().describe('`signerAddress` returned by signBatchSigner.'),
      participant,
      signingPubKey: z.string().describe('`signingPubKey` returned by signBatchSigner.'),
    },
    run: async args => {
      const result = await args.custody.xrpl.getBatchSignature({ ...args.input, domainId: args.domainId })
      return result === undefined
        ? {
            signed: false,
            message:
              'Not signed yet: the signing Intent is probably still awaiting approval. This is not an error; follow it with waitForIntent and call getBatchSignature again.',
          }
        : { signed: true, batchSigner: result.custodyBatchSigner }
    },
  }),

  proposeBatchIntent: defineCustodyTool({
    id: 'proposeBatchIntent',
    description:
      'Step 3 of a Batch: propose the Batch with the signatures collected from getBatchSignature. The Batch input must be the same as the one given to dryRunBatchIntent. Returns the Intent id and payload id at once, without waiting for approvals (see waitForIntent). Never propose the same Batch twice: check it with getIntent first.',
    access: 'propose',
    domain: true,
    input: {
      ...batchInput,
      batchSigners: z
        .array(z.object({ participant, publicKey: z.string(), signature: z.string() }))
        .describe(
          'The `batchSigner` of each signed entry from getBatchSignature, plus those of accounts off this instance.',
        ),
    },
    run: async args => {
      const { batchSigners, ...batch } = args.input
      const { payload, options } = batchParams(batch, args.domainId)
      const { intentId, payloadId } = await args.custody.xrpl.proposeBatch(
        payload,
        batchSigners as Core_BatchSigner[],
        options,
      )
      return { intentId, payloadId }
    },
  }),
})
