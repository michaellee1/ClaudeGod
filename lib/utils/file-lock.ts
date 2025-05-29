import { promises as fs } from 'fs'
import path from 'path'

<<<<<<< HEAD
interface LockInfo {
  promise: Promise<void>
  timestamp: number
}

export class FileLock {
  private static locks = new Map<string, LockInfo>()
=======
export class FileLock {
  private static locks = new Map<string, Promise<void>>()
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
  private static lockDir = path.join(process.env.TMPDIR || '/tmp', 'claude-god-locks')
  
  static async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(this.lockDir, { recursive: true })
    } catch (error) {
      console.error('Failed to create lock directory:', error)
    }
  }
  
<<<<<<< HEAD
  static clearAllLocks(): void {
    console.log(`Clearing ${this.locks.size} in-memory locks`)
    this.locks.clear()
  }
  
=======
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
  static async acquireLock(filePath: string, timeout: number = 30000): Promise<() => void> {
    const lockKey = path.resolve(filePath)
    const startTime = Date.now()
    
<<<<<<< HEAD
    // Check if lock exists and if it's stale (older than timeout)
    const existingLock = this.locks.get(lockKey)
    if (existingLock && existingLock.timestamp && Date.now() - existingLock.timestamp > timeout) {
      console.warn(`Removing stale lock for ${filePath} (age: ${Date.now() - existingLock.timestamp}ms)`)
      this.locks.delete(lockKey)
    }
    
    // Wait for existing lock to be released with timeout
    while (this.locks.has(lockKey)) {
      if (Date.now() - startTime > timeout) {
        // Force remove the lock if it's been too long
        console.error(`Force removing lock for ${filePath} after ${timeout}ms timeout`)
        this.locks.delete(lockKey)
        break
      }
      
      const lockPromise = this.locks.get(lockKey)
      if (lockPromise && lockPromise.promise) {
        // Wait for lock with a smaller timeout
        await Promise.race([
          lockPromise.promise,
=======
    // Wait for existing lock to be released with timeout
    while (this.locks.has(lockKey)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Failed to acquire lock for ${filePath} after ${timeout}ms`)
      }
      
      const lockPromise = this.locks.get(lockKey)
      if (lockPromise) {
        // Wait for lock with a smaller timeout
        await Promise.race([
          lockPromise,
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
          new Promise(resolve => setTimeout(resolve, 1000))
        ])
      }
      
      // Small delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // Create a promise that will be resolved when lock is released
    let releaseLock: () => void
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve
    })
    
<<<<<<< HEAD
    // Store lock with timestamp for stale detection
    this.locks.set(lockKey, {
      promise: lockPromise,
      timestamp: Date.now()
    })
=======
    this.locks.set(lockKey, lockPromise)
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
    
    // Return release function
    return () => {
      this.locks.delete(lockKey)
      releaseLock()
    }
  }
  
<<<<<<< HEAD
  static async withLock<T>(filePath: string, operation: () => Promise<T>, timeout?: number): Promise<T> {
    const release = await this.acquireLock(filePath, timeout)
=======
  static async withLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(filePath)
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}