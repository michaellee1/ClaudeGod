import { promises as fs } from 'fs'
import path from 'path'

export class FileLock {
  private static locks = new Map<string, Promise<void>>()
  private static lockDir = path.join(process.env.TMPDIR || '/tmp', 'claude-god-locks')
  
  static async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(this.lockDir, { recursive: true })
    } catch (error) {
      console.error('Failed to create lock directory:', error)
    }
  }
  
  static async acquireLock(filePath: string, timeout: number = 30000): Promise<() => void> {
    const lockKey = path.resolve(filePath)
    const startTime = Date.now()
    
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
    
    this.locks.set(lockKey, lockPromise)
    
    // Return release function
    return () => {
      this.locks.delete(lockKey)
      releaseLock()
    }
  }
  
  static async withLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(filePath)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}