import { NextResponse } from 'next/server'
import { getPersistentState } from '@/lib/utils/persistent-state'
import { getPersistentLogger } from '@/lib/utils/persistent-logger'
import { getSyncService } from '@/lib/utils/sync-service'
import { recoveryManager } from '@/lib/utils/recovery-manager'
import { taskStore } from '@/lib/utils/task-store'

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: Date
  components: {
    persistence: ComponentHealth
    sync: ComponentHealth
    recovery: ComponentHealth
    tasks: ComponentHealth
    terminals: ComponentHealth
  }
  metrics: {
    activeTasks: number
    totalTasks: number
    activeTerminals: number
    uptime: number
    memoryUsage: NodeJS.MemoryUsage
  }
  warnings: string[]
  errors: string[]
}

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  lastCheck?: Date
}

export async function GET() {
  const startTime = Date.now()
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date(),
    components: {
      persistence: { status: 'healthy' },
      sync: { status: 'healthy' },
      recovery: { status: 'healthy' },
      tasks: { status: 'healthy' },
      terminals: { status: 'healthy' }
    },
    metrics: {
      activeTasks: 0,
      totalTasks: 0,
      activeTerminals: 0,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    },
    warnings: [],
    errors: []
  }
  
  try {
    // Check persistent state
    await checkPersistentState(health)
    
    // Check sync service
    checkSyncService(health)
    
    // Check recovery status
    await checkRecoveryStatus(health)
    
    // Check task store
    checkTaskStore(health)
    
    // Check terminal sessions
    checkTerminalStatus(health)
    
    // Determine overall health
    const components = Object.values(health.components)
    if (components.some(c => c.status === 'unhealthy')) {
      health.status = 'unhealthy'
    } else if (components.some(c => c.status === 'degraded')) {
      health.status = 'degraded'
    }
    
    // Log health check
    await getPersistentLogger().logSystemEvent('health-check', {
      status: health.status,
      duration: Date.now() - startTime
    })
    
    return NextResponse.json(health, {
      status: health.status === 'unhealthy' ? 503 : 200
    })
    
  } catch (error) {
    console.error('Health check error:', error)
    health.status = 'unhealthy'
    health.errors.push(error instanceof Error ? error.message : String(error))
    
    return NextResponse.json(health, { status: 503 })
  }
}

async function checkPersistentState(health: HealthStatus) {
  try {
    const persistentState = getPersistentState()
    const snapshots = await persistentState.getAvailableSnapshots()
    
    if (snapshots.length === 0) {
      health.components.persistence.status = 'degraded'
      health.components.persistence.message = 'No snapshots available'
      health.warnings.push('No persistent state snapshots found')
    } else {
      const latestSnapshot = snapshots[0]
      const hoursSinceSnapshot = (Date.now() - latestSnapshot.timestamp.getTime()) / (1000 * 60 * 60)
      
      if (hoursSinceSnapshot > 24) {
        health.components.persistence.status = 'degraded'
        health.components.persistence.message = `Latest snapshot is ${Math.round(hoursSinceSnapshot)} hours old`
        health.warnings.push('Persistent state snapshot is outdated')
      } else {
        health.components.persistence.message = `${snapshots.length} snapshots available`
      }
    }
    
    health.components.persistence.lastCheck = new Date()
  } catch (error) {
    health.components.persistence.status = 'unhealthy'
    health.components.persistence.message = error instanceof Error ? error.message : 'Unknown error'
    health.errors.push('Persistent state check failed')
  }
}

function checkSyncService(health: HealthStatus) {
  try {
    const syncService = getSyncService()
    const status = syncService.getSyncStatus()
    
    if (!status.isRunning) {
      health.components.sync.status = 'unhealthy'
      health.components.sync.message = 'Sync service not running'
      health.errors.push('Sync service is not running')
    } else if (status.lastSyncTime) {
      const minutesSinceSync = (Date.now() - status.lastSyncTime.getTime()) / (1000 * 60)
      
      if (minutesSinceSync > 5) {
        health.components.sync.status = 'degraded'
        health.components.sync.message = `Last sync was ${Math.round(minutesSinceSync)} minutes ago`
        health.warnings.push('Sync service may be delayed')
      } else {
        health.components.sync.message = 'Sync service running normally'
      }
    } else {
      health.components.sync.status = 'degraded'
      health.components.sync.message = 'No sync completed yet'
    }
    
    health.components.sync.lastCheck = new Date()
  } catch (error) {
    health.components.sync.status = 'unhealthy'
    health.components.sync.message = error instanceof Error ? error.message : 'Unknown error'
    health.errors.push('Sync service check failed')
  }
}

async function checkRecoveryStatus(health: HealthStatus) {
  try {
    const status = await recoveryManager.getRecoveryStatus()
    
    if (status.dataIntegrity === 'error') {
      health.components.recovery.status = 'unhealthy'
      health.components.recovery.message = 'Data integrity issues detected'
      health.errors.push('Recovery system reports data integrity issues')
    } else if (status.dataIntegrity === 'warning') {
      health.components.recovery.status = 'degraded'
      health.components.recovery.message = status.recommendations.join('; ')
      status.recommendations.forEach(r => health.warnings.push(r))
    } else {
      health.components.recovery.message = `${status.availableSnapshots} snapshots available for recovery`
    }
    
    health.components.recovery.lastCheck = new Date()
  } catch (error) {
    health.components.recovery.status = 'unhealthy'
    health.components.recovery.message = error instanceof Error ? error.message : 'Unknown error'
    health.errors.push('Recovery system check failed')
  }
}

function checkTaskStore(health: HealthStatus) {
  try {
    const tasks = taskStore.getTasks()
    health.metrics.totalTasks = tasks.length
    
    const activeTasks = tasks.filter(t => 
      t.status === 'in_progress' || t.status === 'starting'
    )
    health.metrics.activeTasks = activeTasks.length
    
    // Check for hung tasks
    const now = Date.now()
    const hungTasks = activeTasks.filter(t => {
      const lastActivity = t.lastActivityTime?.getTime() || t.createdAt.getTime()
      return (now - lastActivity) > 600000 // 10 minutes
    })
    
    if (hungTasks.length > 0) {
      health.components.tasks.status = 'degraded'
      health.components.tasks.message = `${hungTasks.length} tasks may be hung`
      health.warnings.push(`Found ${hungTasks.length} potentially hung tasks`)
    } else {
      health.components.tasks.message = `${activeTasks.length} active, ${tasks.length} total tasks`
    }
    
    health.components.tasks.lastCheck = new Date()
  } catch (error) {
    health.components.tasks.status = 'unhealthy'
    health.components.tasks.message = error instanceof Error ? error.message : 'Unknown error'
    health.errors.push('Task store check failed')
  }
}

function checkTerminalStatus(health: HealthStatus) {
  try {
    const activeSessions = taskStore.getActiveTerminalSessions()
    health.metrics.activeTerminals = activeSessions.length
    
    if (activeSessions.length > 0) {
      health.components.terminals.message = `${activeSessions.length} active terminal sessions`
    } else {
      health.components.terminals.message = 'No active terminal sessions'
    }
    
    health.components.terminals.lastCheck = new Date()
  } catch (error) {
    health.components.terminals.status = 'unhealthy'
    health.components.terminals.message = error instanceof Error ? error.message : 'Unknown error'
    health.errors.push('Terminal check failed')
  }
}