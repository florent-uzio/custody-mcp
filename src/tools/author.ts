import type { CustodyClient } from '../custody'
import type { Environment } from '../environments'

/** The Environment's user in a domain: the author of the Intents it proposes and the decisions it casts there. */
export const authorIn = async (custody: CustodyClient, environment: Environment, domainId: string) => {
  const { domains } = await custody.users.me()
  const userId = domains.find(domain => domain.id === domainId)?.userReference.id
  if (userId === undefined) {
    throw new Error(`The user of Environment "${environment.name}" does not belong to domain ${domainId}.`)
  }
  return { domainId, id: userId }
}
