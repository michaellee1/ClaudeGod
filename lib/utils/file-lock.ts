import { promises as fs } from 'fs'
import path from 'path'

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
interface LockInfo {
  promise: Promise<void>
  timestamp: number
}

<<<<<<< HEAD
export class FileLock {
  private static locks = new Map<string, LockInfo>()
=======
export class FileLock {
  private static locks = new Map<string, Promise<void>>()
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
=======
export class FileLock {
  private static locks = new Map<string, LockInfo>()
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
  private static lockDir = path.join(process.env.TMPDIR || '/tmp', 'claude-god-locks')
  
  static async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(this.lockDir, { recursive: true })
    } catch (error) {
      console.error('Failed to create lock directory:', error)
    }
  }
  
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
  static clearAllLocks(): void {
    console.log(`Clearing ${this.locks.size} in-memory locks`)
    this.locks.clear()
  }
  
<<<<<<< HEAD
=======
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
  static async acquireLock(filePath: string, timeout: number = 30000): Promise<() => void> {
    const lockKey = path.resolve(filePath)
    const startTime = Date.now()
    
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
    // Check if lock exists and if it's stale (older than timeout)
    const existingLock = this.locks.get(lockKey)
    if (existingLock && existingLock.timestamp && Date.now() - existingLock.timestamp > timeout) {
      console.warn(`Removing stale lock for ${filePath} (age: ${Date.now() - existingLock.timestamp}ms)`)
      this.locks.delete(lockKey)
    }
    
<<<<<<< HEAD
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
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
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
<<<<<<< HEAD
          lockPromise,
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
=======
          lockPromise.promise,
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
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
<<<<<<< HEAD
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
    // Store lock with timestamp for stale detection
    this.locks.set(lockKey, {
      promise: lockPromise,
      timestamp: Date.now()
    })
<<<<<<< HEAD
=======
    this.locks.set(lockKey, lockPromise)
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
=======
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
    
    // Return release function
    return () => {
      this.locks.delete(lockKey)
      releaseLock()
    }
  }
  
<<<<<<< HEAD
<<<<<<< HEAD
  static async withLock<T>(filePath: string, operation: () => Promise<T>, timeout?: number): Promise<T> {
    const release = await this.acquireLock(filePath, timeout)
=======
  static async withLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(filePath)
>>>>>>> 4977329 (Complete task: Find and fix bugs within the initiatives pipeline. Ultrathink)
=======
  static async withLock<T>(filePath: string, operation: () => Promise<T>, timeout?: number): Promise<T> {
    const release = await this.acquireLock(filePath, timeout)
>>>>>>> 84df07a (Complete task: I get \"Failed to acquire lock for /Users/michaellee/.claude-god-data/initiatives.json after 30000ms\" when creating an initiative.)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}