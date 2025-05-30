# Resilient Architecture Documentation

## Overview

This document describes the redundant file-based persistence system implemented to ensure data integrity and resilience against server crashes, WebSocket failures, and connection issues.

## Architecture Components

### 1. Persistent Logger (`lib/utils/persistent-logger.ts`)

The PersistentLogger provides comprehensive logging of all system events to disk:

- **Event Categories**: WebSocket events, task events, initiative events, system events, and errors
- **File Rotation**: Automatic rotation when files exceed size limits
- **Buffered Writing**: Efficient batch writes with configurable flush intervals
- **Query Interface**: Search logs by type, category, task ID, or time range

**Key Features:**
- Logs are written to `~/.claude-god-data/logs/`
- Separate log files for each category
- JSON format for easy parsing
- Automatic cleanup of old log files

### 2. Persistent State (`lib/utils/persistent-state.ts`)

The PersistentState manager maintains redundant copies of all critical data:

- **Task Persistence**: Individual files for each task and its outputs
- **Initiative Persistence**: Separate storage for initiative data
- **Automatic Snapshots**: Periodic snapshots of entire system state
- **Version Control**: State versioning for compatibility

**Storage Structure:**
```
~/.claude-god-data/state/
├── tasks/              # Individual task files
├── initiatives/        # Initiative files
├── snapshots/         # Point-in-time snapshots
├── recovery/          # Recovery backups
└── current-state.json # Current state metadata
```

### 3. Sync Service (`lib/utils/sync-service.ts`)

Background service that maintains consistency between memory and disk:

- **Periodic Sync**: Configurable sync intervals (default: 30 seconds)
- **Conflict Resolution**: Strategies for handling data conflicts
- **Bidirectional Sync**: Updates flow both ways
- **Real-time Monitoring**: Tracks sync status and conflicts

**Conflict Resolution Strategies:**
- `memory-wins`: In-memory state takes precedence
- `persistent-wins`: Disk state takes precedence
- `newest-wins`: Most recent update wins (default)

### 4. Recovery Manager (`lib/utils/recovery-manager.ts`)

Handles system recovery after crashes or restarts:

- **Automatic Recovery**: Detects and recovers interrupted tasks
- **Process Reconnection**: Attempts to reconnect to running processes
- **Data Integrity Checks**: Validates recovered data
- **Snapshot Restoration**: Can restore from any previous snapshot

**Recovery Process:**
1. Check for tasks marked as "in_progress" during shutdown
2. Verify if associated processes are still running
3. Reconnect to live processes or mark tasks for user action
4. Restore outputs and state from persistent storage
5. Verify data integrity

### 5. Graceful Shutdown (`lib/utils/graceful-shutdown.ts`)

Ensures clean shutdown with data persistence:

- **Signal Handling**: Responds to SIGTERM, SIGINT, etc.
- **Ordered Shutdown**: Stops services in correct order
- **Final Sync**: Forces final data sync before exit
- **Timeout Protection**: Prevents hanging during shutdown

**Shutdown Sequence:**
1. Stop accepting new connections
2. Close existing WebSocket connections
3. Stop background services (sync, monitoring)
4. Save current state and create final snapshot
5. Close persistent services
6. Exit cleanly

## Data Flow

### Normal Operation

```
User Action → WebSocket → Task Store → Memory Cache
                ↓                           ↓
           Persistent Logger          Sync Service
                ↓                           ↓
            Log Files              Persistent State
                                          ↓
                                    State Files
```

### Recovery Flow

```
Server Start → Recovery Manager → Persistent State
                    ↓                    ↓
              Process Check         Load State
                    ↓                    ↓
              Reconnect/Mark        Task Store
                                        ↓
                                  Normal Operation
```

## Configuration

### Environment Variables

- `PERSISTENT_STATE_DIR`: Override default state directory
- `SYNC_INTERVAL`: Sync interval in milliseconds (default: 30000)
- `SNAPSHOT_INTERVAL`: Snapshot interval in milliseconds (default: 300000)
- `MAX_LOG_SIZE`: Maximum log file size in bytes (default: 10MB)

### File Locations

All persistent data is stored in `~/.claude-god-data/`:

- `/logs/` - Event logs
- `/state/` - Current state and snapshots
- `/state/tasks/` - Individual task files
- `/state/initiatives/` - Initiative files
- `/state/snapshots/` - System snapshots
- `/state/recovery/` - Recovery backups

## Health Monitoring

The `/api/health` endpoint provides real-time system health:

```json
{
  "status": "healthy",
  "components": {
    "persistence": { "status": "healthy", "message": "5 snapshots available" },
    "sync": { "status": "healthy", "message": "Sync service running normally" },
    "recovery": { "status": "healthy", "message": "5 snapshots available for recovery" },
    "tasks": { "status": "healthy", "message": "2 active, 10 total tasks" },
    "websocket": { "status": "healthy", "message": "3 active connections" }
  },
  "metrics": {
    "activeTasks": 2,
    "totalTasks": 10,
    "uptime": 3600,
    "memoryUsage": { ... }
  }
}
```

## Testing Resilience

Use the `test-resilience.js` script to verify system resilience:

```bash
node test-resilience.js
```

Tests include:
1. **Crash Recovery**: Simulates server crash and verifies task recovery
2. **WebSocket Reconnection**: Tests connection resilience
3. **Data Persistence**: Verifies files are being written
4. **Health Monitoring**: Checks health endpoint functionality
5. **Graceful Shutdown**: Tests clean shutdown process

## Best Practices

### For Developers

1. **Always use the TaskStore API** - Don't bypass it to modify tasks directly
2. **Handle WebSocket disconnections** - Implement reconnection logic in clients
3. **Monitor health endpoint** - Set up alerts for degraded/unhealthy status
4. **Regular snapshots** - Ensure snapshot interval is appropriate for your usage

### For Operations

1. **Backup the data directory** - Regular backups of `~/.claude-god-data/`
2. **Monitor disk space** - Logs and snapshots can grow over time
3. **Use graceful shutdown** - Always use SIGTERM instead of SIGKILL
4. **Check recovery reports** - Review logs after restarts for recovery issues

## Troubleshooting

### Common Issues

1. **"No snapshots available"**
   - The system hasn't created its first snapshot yet
   - Wait for the snapshot interval or trigger manually

2. **"Sync service delayed"**
   - High system load or I/O bottleneck
   - Check disk performance and system resources

3. **"Task recovery failed"**
   - Process died before task could be saved
   - Check logs for the specific error

4. **"Data integrity issues"**
   - Corruption detected in persistent files
   - Restore from a recent snapshot

### Recovery Procedures

1. **Restore from snapshot:**
   ```bash
   # List available snapshots
   ls ~/.claude-god-data/state/snapshots/
   
   # Restore (implement restore script)
   node scripts/restore-snapshot.js <snapshot-id>
   ```

2. **Force sync:**
   ```bash
   # Trigger immediate sync via API
   curl -X POST http://localhost:3000/api/sync/force
   ```

3. **Clean recovery:**
   ```bash
   # Stop server
   # Delete current-state.json
   rm ~/.claude-god-data/state/current-state.json
   # Restart - will trigger full recovery
   ```

## Performance Considerations

- **Sync Interval**: Lower intervals = better data safety but more I/O
- **Snapshot Frequency**: Balance between recovery points and disk usage
- **Log Retention**: Configure based on debugging needs vs disk space
- **Memory Usage**: Each task in memory also exists on disk

## Future Enhancements

1. **Compression**: Implement log and snapshot compression
2. **Remote Backup**: Support for S3/cloud storage backup
3. **Replication**: Multi-instance support with data replication
4. **Metrics Export**: Prometheus/Grafana integration
5. **Audit Trail**: Comprehensive audit logging for compliance