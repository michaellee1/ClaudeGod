export interface QueueItem {
  taskId: string
  resolve: () => void
  reject: (error: Error) => void
}

export class MergeLock {
  private currentOwner: string | null = null
  private lockQueue: QueueItem[] = []
  private lockPromise: Promise<void> | null = null
  
  async acquireLock(taskId: string): Promise<void> {
    // If no lock exists, acquire it immediately
    if (!this.lockPromise && !this.currentOwner) {
      this.currentOwner = taskId
      return
    }
    
    // If this task already owns the lock, return immediately
    if (this.currentOwner === taskId) {
      return
    }
    
    // Wait for current lock to be released
    if (this.lockPromise) {
      await this.lockPromise
    }
    
    // Create a new promise for this lock request
    return new Promise<void>((resolve, reject) => {
      // Check again if lock is free (might have been released while waiting)
      if (!this.currentOwner) {
        this.currentOwner = taskId
        resolve()
        return
      }
      
      // Add to queue
      this.lockQueue.push({ taskId, resolve, reject })
      
      // Create a promise that resolves when this task gets the lock
      this.lockPromise = new Promise<void>((res) => {
        const checkQueue = () => {
          if (this.currentOwner === taskId) {
            res()
          } else {
            // Wait and check again
            setTimeout(checkQueue, 100)
          }
        }
        checkQueue()
      })
    })
  }
  
  releaseLock(taskId: string): void {
    if (this.currentOwner !== taskId) {
      console.warn(`Task ${taskId} tried to release lock owned by ${this.currentOwner}`)
      return
    }
    
    // Clear current owner
    this.currentOwner = null
    this.lockPromise = null
    
    // Process next in queue
    if (this.lockQueue.length > 0) {
      const next = this.lockQueue.shift()!
      this.currentOwner = next.taskId
      next.resolve()
    }
  }
  
  isLockedBy(taskId: string): boolean {
    return this.currentOwner === taskId
  }
  
  getCurrentOwner(): string | null {
    return this.currentOwner
  }
  
  getQueueLength(): number {
    return this.lockQueue.length
  }
  
  // Force clear the lock (for emergency recovery)
  forceClear(): void {
    const wasOwner = this.currentOwner
    this.currentOwner = null
    this.lockPromise = null
    
    // Reject all queued items
    while (this.lockQueue.length > 0) {
      const item = this.lockQueue.shift()!
      item.reject(new Error(`Lock forcefully cleared (was owned by ${wasOwner})`))
    }
  }
}

export const mergeLock = new MergeLock()