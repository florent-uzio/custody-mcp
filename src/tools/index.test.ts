import { describe, expect, it } from 'vitest'
import { ENV_VARS, fakeCustody } from '../testing'
import { createTools, mergeTools } from './index'
import { CUSTODY_INSTRUCTIONS } from './instructions'

const tools = createTools(ENV_VARS, () => fakeCustody({}))

describe('the tool registry', () => {
  it('registers every tool under its own id', () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool).toMatchObject({ id: name })
    }
  })

  it('refuses two tools with the same id', () => {
    const { getMe, listUsers } = tools
    expect(() => mergeTools([{ getMe }, { listUsers, getMe }])).toThrow('Duplicate tool id: getMe')
  })

  it('knows every tool the instructions name', () => {
    const named = CUSTODY_INSTRUCTIONS.match(/\b(get|list|find|propose|dryRun|wait|approve|reject|decrypt)[A-Z]\w*/g)
    expect(named).not.toBeNull()
    for (const name of new Set(named)) {
      expect(Object.keys(tools), `instructions name ${name}`).toContain(name)
    }
  })
})
