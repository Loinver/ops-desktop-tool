import { describe, it, expect } from 'vitest'
import { routeForOpsEvent } from '../../src/renderer/utils/ops-event-route.js'

describe('routeForOpsEvent', () => {
  it('routes release events to /system-release', () => {
    const result = routeForOpsEvent({ sourceType: 'release', id: 'evt-1' })
    expect(result.path).toBe('/system-release')
    expect(result.query.event).toBe('evt-1')
  })

  it('routes model events to /model-test', () => {
    const result = routeForOpsEvent({ sourceType: 'model', id: 'evt-2' })
    expect(result.path).toBe('/model-test')
  })

 it('routes model-monitor events to /model-test', () => {
    const result = routeForOpsEvent({ sourceType: 'model-monitor', id: 'evt-3' })
    expect(result.path).toBe('/model-test')
  })

  it('routes automation events to /ops-control-center', () => {
    const result = routeForOpsEvent({ sourceType: 'automation', id: 'evt-4' })
    expect(result.path).toBe('/ops-control-center')
  })

  it('routes unknown sourceType to /ops-control-center', () => {
    const result = routeForOpsEvent({ sourceType: 'unknown-type', id: 'evt-5' })
    expect(result.path).toBe('/ops-control-center')
  })

  it('defaults to system sourceType when none provided', () => {
    const result = routeForOpsEvent({})
    expect(result.path).toBe('/ops-control-center')
  })

  it('extracts protocol and port for node-service events', () => {
    const result = routeForOpsEvent({
      sourceType: 'node-service',
      id: 'evt-6',
      sourceId: 'tcp:3000',
      attributes: { protocol: 'tcp', port: '3000' },
    })
    expect(result.path).toBe('/node-services')
    expect(result.query.protocol).toBe('tcp')
    expect(result.query.port).toBe('3000')
  })

  it('parses protocol and port from sourceId when attributes absent', () => {
    const result = routeForOpsEvent({
      sourceType: 'node-service',
      id: 'evt-7',
      sourceId: 'http:8080',
    })
    expect(result.query.protocol).toBe('http')
    expect(result.query.port).toBe('8080')
  })

  it('omits undefined query values', () => {
    const result = routeForOpsEvent({ sourceType: 'release' })
    expect(result.query.event).toBeUndefined()
    expect(Object.keys(result.query)).not.toContain('event')
  })

  it('routes log events to /ai-ops', () => {
    const result = routeForOpsEvent({ sourceType: 'log', id: 'evt-8' })
    expect(result.path).toBe('/ai-ops')
  })

  it('routes copilot events to /ai-ops', () => {
    const result = routeForOpsEvent({ sourceType: 'copilot', id: 'evt-9' })
    expect(result.path).toBe('/ai-ops')
  })

  it('routes data-backup events to /data-management', () => {
    const result = routeForOpsEvent({ sourceType: 'data-backup', id: 'evt-10' })
    expect(result.path).toBe('/data-management')
  })
})
