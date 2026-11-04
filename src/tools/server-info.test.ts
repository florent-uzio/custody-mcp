import { describe, expect, it } from 'vitest'
import { callTool, devServerOptions, fakeCustody } from '../testing'

describe('server info tools', () => {
  describe('getBackendVersion', () => {
    it('returns the version of the Custody instance', async () => {
      const custody = fakeCustody({ backendVersion: async () => '2.8.1' })

      const output = await callTool(devServerOptions(custody), 'getBackendVersion')

      expect(output).toEqual({ environment: 'dev', backendVersion: '2.8.1' })
    })
  })
})
