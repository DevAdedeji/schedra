import type { H3Event } from 'h3'
import type { Database } from '../database/client'
import { securityAuditLogs } from '../database/schema'
import { useDatabase } from '../database'
import { logEvent } from '../observability/logger'

type AuditExecutor = Pick<Database, 'insert'>

export interface SecurityAuditEntry {
  action: string
  actorUserId?: string | null
  actorEmail?: string | null
  organizationId?: string | null
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown> | null
}

export async function recordSecurityAudit(
  entry: SecurityAuditEntry,
  event?: H3Event,
  executor: AuditExecutor = useDatabase()
) {
  try {
    await executor.insert(securityAuditLogs).values({
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      organizationId: entry.organizationId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      requestId: event?.context.requestId ?? null,
      metadata: entry.metadata ?? null
    })
    return true
  } catch (error) {
    logEvent('error', 'security_audit_write_failed', {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      error
    }, event)
    return false
  }
}
