export const ACCESS_LEVELS = ['read', 'propose', 'approve'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/** A named Ripple Custody instance with the credentials of one Custody user on it (see GLOSSARY.md). */
export type Environment = {
  name: string
  authUrl: string
  apiUrl: string
  publicKey: string
  privateKey: string
  access: AccessLevel
}

/** The four env vars custody-mpt-demo uses become one Environment named `env` (ADR-0002). */
export const environmentsFromEnv = (env: Record<string, string | undefined>): Environment[] => {
  const { AUTH_URL, API_URL, PUBLIC_KEY, PRIVATE_KEY } = env
  if (!AUTH_URL || !API_URL || !PUBLIC_KEY || !PRIVATE_KEY) {
    return []
  }

  return [
    {
      name: 'env',
      authUrl: AUTH_URL,
      apiUrl: API_URL,
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      access: parseAccessLevel(env.CUSTODY_ACCESS),
    },
  ]
}

// An unknown value fails closed: guessing could make an Environment writable by mistake.
const parseAccessLevel = (value: string | undefined): AccessLevel => {
  if (value === undefined) {
    return 'read'
  }
  if (!(ACCESS_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`CUSTODY_ACCESS must be one of ${ACCESS_LEVELS.join(', ')} (got "${value}")`)
  }
  return value as AccessLevel
}
