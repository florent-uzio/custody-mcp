import { z } from 'zod'

// The XRPL operations proposeXrplIntent supports, in Custody's `Core_XrplOperation_*` shapes. Checked here so a
// mistake is reported field by field before anything reaches Custody; the Dry run then checks the rest.

const destination = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Address'), address: z.string() }),
    z.object({ type: z.literal('Account'), accountId: z.string() }),
    z.object({ type: z.literal('Endpoint'), endpointId: z.string() }),
  ])
  .describe('Who receives it: an XRPL address, a Custody account id, or a Custody endpoint id.')

/** An XLS-68 sponsor that pays the fee and/or the reserve of a transaction. */
export const sponsorship = z
  .object({
    sponsor: destination.describe('The sponsor: an XRPL address, a Custody account id, or a Custody endpoint id.'),
    flags: z
      .array(z.enum(['spfSponsorFee', 'spfSponsorReserve']))
      .describe('What the sponsor pays: its fee (`spfSponsorFee`), its reserve (`spfSponsorReserve`), or both.'),
  })
  .describe(
    'XLS-68 sponsorship: another account pays the fee and/or owner reserve. On an outer Batch only `spfSponsorFee` is valid.',
  )

const tokenIdentifier = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('MPTokenIssuanceId'), issuanceId: z.string() }),
    z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
  ])
  .describe('The MPT: its issuance id, or the id of its Custody ticker (see listTickers).')

const amount = z.string().describe('Amount, as a string: drops for XRP, else the token amount.')

const payment = z.object({
  type: z.literal('Payment'),
  destination,
  amount,
  destinationTag: z.number().int().optional(),
  flags: z
    .array(z.enum(['tfSponsorCreatedAccount']))
    .optional()
    .describe('`tfSponsorCreatedAccount`: the sponsor pays the reserve of the account this Payment creates.'),
  currency: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('Currency'), code: z.string(), issuer: z.string() }),
      z.object({ type: z.literal('MultiPurposeToken'), issuanceId: z.string() }),
      z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
    ])
    .optional()
    .describe('What is paid: an IOU, an MPT, or a Custody ticker. Omit to pay XRP.'),
})

const trustSet = z.object({
  type: z.literal('TrustSet'),
  limitAmount: z.object({
    currency: z.discriminatedUnion('type', [
      z.object({ type: z.literal('Currency'), code: z.string(), issuer: z.string() }),
      z.object({ type: z.literal('TickerId'), tickerId: z.string() }),
    ]),
    value: z.string().describe('The trust line limit.'),
  }),
  flags: z.array(z.enum(['tfSetFreeze', 'tfClearFreeze', 'tfSetfAuth'])).default([]),
  enableRippling: z.boolean().optional(),
})

const mpTokenAuthorize = z.object({
  type: z.literal('MPTokenAuthorize'),
  tokenIdentifier,
  flags: z.array(z.enum(['tfMPTUnauthorize'])).default([]),
  holder: destination.optional().describe('The holder to authorize, when the issuer sends it.'),
})

const mpTokenIssuanceCreate = z.object({
  type: z.literal('MPTokenIssuanceCreate'),
  flags: z
    .array(
      z.enum([
        'tfMPTRequireAuth',
        'tfMPTCanClawback',
        'tfMPTCanTransfer',
        'tfMPTCanEscrow',
        'tfMPTCanLock',
        'tfMPTCanTrade',
        'tfMPTCanConfidentialAmount',
      ]),
    )
    .default([]),
  assetScale: z.number().int().optional(),
  transferFee: z.number().int().optional(),
  maximumAmount: z.string().optional(),
  metadata: z.object({ type: z.literal('HexEncodedMetadata'), value: z.string() }).optional(),
})

const mpTokenIssuanceDestroy = z.object({ type: z.literal('MPTokenIssuanceDestroy'), tokenIdentifier })

const mpTokenIssuanceSet = z.object({
  type: z.literal('MPTokenIssuanceSet'),
  tokenIdentifier,
  holder: destination.optional(),
  flags: z.array(z.enum(['tfMPTLock', 'tfMPTUnlock'])).default([]),
  mutableFlags: z.array(z.enum(['MPTSetCanConfidentialAmount'])).default([]),
  issuerEncryptionKey: z.string().optional().describe("The issuer's base64 ElGamal public key."),
  auditorEncryptionKey: z.string().optional().describe("The auditor's base64 ElGamal public key."),
})

const confidentialMptClawback = z.object({
  type: z.literal('ConfidentialMPTClawback'),
  tokenIdentifier,
  holder: destination,
})

const confidentialMptConvert = z.object({ type: z.literal('ConfidentialMPTConvert'), tokenIdentifier, amount })

const confidentialMptConvertBack = z.object({ type: z.literal('ConfidentialMPTConvertBack'), tokenIdentifier, amount })

const confidentialMptMergeInbox = z.object({ type: z.literal('ConfidentialMPTMergeInbox'), tokenIdentifier })

const confidentialMptSend = z.object({
  type: z.literal('ConfidentialMPTSend'),
  tokenIdentifier,
  destination,
  amount: amount.optional(),
})

const sponsorshipSetAsSponsor = z.object({
  type: z.literal('SponsorshipSetAsSponsor'),
  sponsee: destination,
  feeAmountDelta: z.string().optional().describe('Drops to add to the fee the sponsor has funded for the sponsee.'),
  remainingOwnerCountDelta: z.number().int().optional().describe('Owner reserves to add to what the sponsee has left.'),
  maxFee: z.string().optional().describe('The most, in drops, the sponsor pays for one transaction.'),
  flags: z
    .array(
      z.enum([
        'tfRequireSignForFee',
        'tfClearRequireSignForFee',
        'tfRequireSignForReserve',
        'tfClearRequireSignForReserve',
        'tfDeleteObject',
      ]),
    )
    .default([]),
})

const sponsorshipSetAsSponsee = z.object({ type: z.literal('SponsorshipSetAsSponsee'), sponsor: destination })

const operations = [
  payment,
  trustSet,
  mpTokenAuthorize,
  mpTokenIssuanceCreate,
  mpTokenIssuanceDestroy,
  mpTokenIssuanceSet,
  confidentialMptClawback,
  confidentialMptConvertBack,
  confidentialMptMergeInbox,
] as const

const sponsorshipOperations = [sponsorshipSetAsSponsor, sponsorshipSetAsSponsee] as const

/** The XRPL operation of a transaction order, in Custody's shape. */
export const xrplOperation = z
  .discriminatedUnion('type', [...operations, confidentialMptConvert, confidentialMptSend, ...sponsorshipOperations])
  .describe('The XRPL operation to propose, chosen by `type`.')

// ConfidentialMPTConvert is left out: Custody V1 does not support it in a Batch.
// Unlike a standalone send, whose proofs Custody builds, a Batch inner send carries them: the caller pastes in what
// buildConfidentialSendLeg returned.
const batchConfidentialMptSend = confidentialMptSend.extend({
  amount: amount.describe('The plaintext amount, as returned by buildConfidentialSendLeg.'),
  senderEncryptedBalance: z.string().describe('Hex, as returned by buildConfidentialSendLeg.'),
  senderEncryptedBalanceVersion: z.number().int().describe('As returned by buildConfidentialSendLeg.'),
  cryptographicFields: z
    .record(z.string(), z.unknown())
    .describe('The proofs, exactly as returned by buildConfidentialSendLeg.'),
})

/**
 * The XRPL operation of a Batch entry. A `ConfidentialMPTSend` must come from buildConfidentialSendLeg, since
 * its proofs are bound to the entry's Ticket.
 */
export const batchXrplOperation = z
  .discriminatedUnion('type', [...operations, batchConfidentialMptSend, ...sponsorshipOperations])
  .describe(
    'The XRPL operation of the entry, chosen by `type`. For `ConfidentialMPTSend`, pass the `operation` returned by buildConfidentialSendLeg unchanged.',
  )
