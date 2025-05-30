import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import os from 'os'
import { EventEmitter } from 'events'

export interface LogEntry {
  timestamp: Date
  type: 'websocket' | 'task' | 'initiative' | 'system' | 'error'
  category: string
  data: any
  metadata?: {
    taskId?: string
    initiativeId?: string
    pid?: number
    phase?: string
    [key: string]: any
  }
}

export interface PersistentLoggerOptions {
  baseDir?: string
  maxFileSize?: number // bytes
  maxFiles?: number
  flushInterval?: number // ms
  compressionEnabled?: boolean
}

/**
 * PersistentLogger provides redundant file-based logging for all critical operations
 * ensuring data persistence even during server crashes or WebSocket failures
 */
export class PersistentLogger extends EventEmitter {
  private baseDir: string
  private maxFileSize: number
  private maxFiles: number
  private flushInterval: number
  private compressionEnabled: boolean
  
  private writeQueue: LogEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private currentLogFile: string
  private currentFileSize: number = 0
  private fileStream: fs.WriteStream | null = null
  private isClosing: boolean = false
  
  // Separate log files for different categories
  private readonly LOG_CATEGORIES = {
    WEBSOCKET: 'websocket',
    TASK: 'task',
    INITIATIVE: 'initiative',
    SYSTEM: 'system',
    ERROR: 'error'
  }
  
  constructor(options: PersistentLoggerOptions = {}) {
    super()
    
    this.baseDir = options.baseDir || path.join(os.homedir(), '.claude-god-data', 'logs')
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024 // 10MB default
    this.maxFiles = options.maxFiles || 50
    this.flushInterval = options.flushInterval || 1000 // 1 second default
    this.compressionEnabled = options.compressionEnabled || false
    
    this.currentLogFile = this.generateLogFileName()
    this.initialize()
  }
  
  private async initialize(): Promise<void> {
    try {
      // Create base directory structure
      await fsPromises.mkdir(this.baseDir, { recursive: true })
      
      // Create category subdirectories
      for (const category of Object.values(this.LOG_CATEGORIES)) {
        await fsPromises.mkdir(path.join(this.baseDir, category), { recursive: true })
      }
      
      // Set up write stream
      await this.createNewLogFile()
      
      // Set up flush timer
      this.startFlushTimer()
      
      // Handle process termination
      process.on('exit', () => this.close())
      process.on('SIGINT', () => this.close())
      process.on('SIGTERM', () => this.close())
      
      this.emit('initialized')
    } catch (error) {
      console.error('Failed to initialize PersistentLogger:', error)
      this.emit('error', error)
    }
  }
  
  /**
   * Log an entry to persistent storage
   */
  async log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
    if (this.isClosing) {
      return
    }
    
    const logEntry: LogEntry = {
      ...entry,
      timestamp: new Date()
    }
    
    // Add to write queue
    this.writeQueue.push(logEntry)
    
    // Write immediately for critical entries
    if (entry.type === 'error' || entry.category === 'critical') {
      await this.flush()
    }
  }
  
  /**
   * Log WebSocket event
   */
  async logWebSocketEvent(event: string, data: any, metadata?: any): Promise<void> {
    await this.log({
      type: 'websocket',
      category: event,
      data,
      metadata
    })
  }
  
  /**
   * Log task event
   */
  async logTaskEvent(taskId: string, event: string, data: any, metadata?: any): Promise<void> {
    await this.log({
      type: 'task',
      category: event,
      data,
      metadata: { taskId, ...metadata }
    })
  }
  
  /**
   * Log initiative event
   */
  async logInitiativeEvent(initiativeId: string, event: string, data: any, metadata?: any): Promise<void> {
    await this.log({
      type: 'initiative',
      category: event,
      data,
      metadata: { initiativeId, ...metadata }
    })
  }
  
  /**
   * Log system event
   */
  async logSystemEvent(event: string, data: any, metadata?: any): Promise<void> {
    await this.log({
      type: 'system',
      category: event,
      data,
      metadata
    })
  }
  
  /**
   * Log error
   */
  async logError(error: Error, context?: any): Promise<void> {
    await this.log({
      type: 'error',
      category: error.name || 'UnknownError',
      data: {
        message: error.message,
        stack: error.stack,
        context
      }
    })
  }
  
  /**
   * Query logs by criteria
   */
  async queryLogs(criteria: {
    type?: LogEntry['type']
    category?: string
    taskId?: string
    initiativeId?: string
    startTime?: Date
    endTime?: Date
    limit?: number
  }): Promise<LogEntry[]> {
    const results: LogEntry[] = []
    
    try {
      // Determine which log files to search
      const filesToSearch = await this.getLogFilesToSearch(criteria)
      
      // Read and parse each file
      for (const file of filesToSearch) {
        const entries = await this.readLogFile(file)
        
        // Filter entries based on criteria
        const filtered = entries.filter(entry => {
          if (criteria.type && entry.type !== criteria.type) return false
          if (criteria.category && entry.category !== criteria.category) return false
          if (criteria.taskId && entry.metadata?.taskId !== criteria.taskId) return false
          if (criteria.initiativeId && entry.metadata?.initiativeId !== criteria.initiativeId) return false
          if (criteria.startTime && new Date(entry.timestamp) < criteria.startTime) return false
          if (criteria.endTime && new Date(entry.timestamp) > criteria.endTime) return false
          return true
        })
        
        results.push(...filtered)
        
        // Check limit
        if (criteria.limit && results.length >= criteria.limit) {
          return results.slice(0, criteria.limit)
        }
      }
      
      // Sort by timestamp descending
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      
      return criteria.limit ? results.slice(0, criteria.limit) : results
    } catch (error) {
      console.error('Error querying logs:', error)
      return []
    }
  }
  
  /**
   * Get task snapshot from logs
   */
  async getTaskSnapshot(taskId: string): Promise<any> {
    const logs = await this.queryLogs({
      taskId,
      type: 'task'
    })
    
    // Reconstruct task state from logs
    const snapshot: any = {
      taskId,
      events: [],
      outputs: [],
      status: 'unknown',
      lastUpdate: null
    }
    
    for (const log of logs) {
      snapshot.events.push({
        timestamp: log.timestamp,
        event: log.category,
        data: log.data
      })
      
      // Extract specific data based on event type
      if (log.category === 'output') {
        snapshot.outputs.push(log.data)
      } else if (log.category === 'status-change') {
        snapshot.status = log.data.status
      }
      
      if (!snapshot.lastUpdate || new Date(log.timestamp) > new Date(snapshot.lastUpdate)) {
        snapshot.lastUpdate = log.timestamp
      }
    }
    
    return snapshot
  }
  
  /**
   * Flush write queue to disk
   */
  private async flush(): Promise<void> {
    if (this.writeQueue.length === 0 || !this.fileStream) {
      return
    }
    
    const entriesToWrite = [...this.writeQueue]
    this.writeQueue = []
    
    try {
      // Write entries to file
      for (const entry of entriesToWrite) {
        const line = JSON.stringify(entry) + '\n'
        const lineSize = Buffer.byteLength(line)
        
        // Check if we need to rotate the file
        if (this.currentFileSize + lineSize > this.maxFileSize) {
          await this.rotateLogFile()
        }
        
        // Write to current file
        await this.writeToFile(line)
        this.currentFileSize += lineSize
        
        // Also write to category-specific file
        await this.writeToCategoryFile(entry)
      }
      
      this.emit('flushed', entriesToWrite.length)
    } catch (error) {
      console.error('Error flushing logs:', error)
      // Re-add entries to queue for retry
      this.writeQueue.unshift(...entriesToWrite)
      this.emit('error', error)
    }
  }
  
  /**
   * Write to main log file
   */
  private async writeToFile(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.fileStream) {
        reject(new Error('File stream not initialized'))
        return
      }
      
      this.fileStream.write(data, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
  
  /**
   * Write to category-specific file
   */
  private async writeToCategoryFile(entry: LogEntry): Promise<void> {
    const categoryDir = path.join(this.baseDir, entry.type)
    const categoryFile = path.join(categoryDir, `${entry.type}-${this.getDateString()}.log`)
    
    try {
      await fsPromises.appendFile(categoryFile, JSON.stringify(entry) + '\n')
    } catch (error) {
      console.error(`Error writing to category file ${categoryFile}:`, error)
    }
  }
  
  /**
   * Create new log file
   */
  private async createNewLogFile(): Promise<void> {
    if (this.fileStream) {
      this.fileStream.end()
    }
    
    this.currentLogFile = this.generateLogFileName()
    this.currentFileSize = 0
    
    this.fileStream = fs.createWriteStream(
      path.join(this.baseDir, this.currentLogFile),
      { flags: 'a' }
    )
    
    this.fileStream.on('error', (error) => {
      console.error('Log file stream error:', error)
      this.emit('error', error)
    })
  }
  
  /**
   * Rotate log file
   */
  private async rotateLogFile(): Promise<void> {
    await this.createNewLogFile()
    await this.cleanupOldFiles()
  }
  
  /**
   * Clean up old log files
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fsPromises.readdir(this.baseDir)
      const logFiles = files
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse()
      
      // Remove old files beyond maxFiles limit
      if (logFiles.length > this.maxFiles) {
        const filesToDelete = logFiles.slice(this.maxFiles)
        for (const file of filesToDelete) {
          await fsPromises.unlink(path.join(this.baseDir, file))
        }
      }
    } catch (error) {
      console.error('Error cleaning up old log files:', error)
    }
  }
  
  /**
   * Read log file
   */
  private async readLogFile(filePath: string): Promise<LogEntry[]> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8')
      const lines = content.trim().split('\n').filter(line => line)
      
      return lines.map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      }).filter(entry => entry !== null)
    } catch (error) {
      console.error(`Error reading log file ${filePath}:`, error)
      return []
    }
  }
  
  /**
   * Get log files to search based on criteria
   */
  private async getLogFilesToSearch(criteria: any): Promise<string[]> {
    const files: string[] = []
    
    try {
      // If type is specified, look in category directory
      if (criteria.type) {
        const categoryDir = path.join(this.baseDir, criteria.type)
        const categoryFiles = await fsPromises.readdir(categoryDir)
        files.push(...categoryFiles.map(f => path.join(categoryDir, f)))
      } else {
        // Search main log directory
        const mainFiles = await fsPromises.readdir(this.baseDir)
        files.push(...mainFiles
          .filter(f => f.endsWith('.log'))
          .map(f => path.join(this.baseDir, f)))
      }
      
      // Filter by date range if specified
      if (criteria.startTime || criteria.endTime) {
        return files.filter(file => {
          const fileName = path.basename(file)
          const match = fileName.match(/(\d{4}-\d{2}-\d{2})/)
          if (!match) return false
          
          const fileDate = new Date(match[1])
          if (criteria.startTime && fileDate < criteria.startTime) return false
          if (criteria.endTime && fileDate > criteria.endTime) return false
          return true
        })
      }
      
      return files
    } catch (error) {
      console.error('Error getting log files:', error)
      return []
    }
  }
  
  /**
   * Generate log file name
   */
  private generateLogFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    return `claude-god-${timestamp}.log`
  }
  
  /**
   * Get date string for file naming
   */
  private getDateString(): string {
    return new Date().toISOString().split('T')[0]
  }
  
  /**
   * Start flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        console.error('Error in flush timer:', error)
      })
    }, this.flushInterval)
  }
  
  /**
   * Close logger
   */
  async close(): Promise<void> {
    if (this.isClosing) {
      return
    }
    
    this.isClosing = true
    
    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    
    // Flush remaining entries
    await this.flush()
    
    // Close file stream
    if (this.fileStream) {
      await new Promise<void>((resolve) => {
        this.fileStream!.end(() => resolve())
      })
    }
    
    this.emit('closed')
  }
}

// Singleton instance
let loggerInstance: PersistentLogger | null = null

export function getPersistentLogger(): PersistentLogger {
  if (!loggerInstance) {
    loggerInstance = new PersistentLogger()
  }
  return loggerInstance
}