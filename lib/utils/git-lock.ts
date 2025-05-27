export class GitOperationLock {
  private locks: Map<string, Promise<void>> = new Map()
  
  async withLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    // Wait for any existing operation on this repo to complete
    const existingLock = this.locks.get(repoPath)
    if (existingLock) {
      await existingLock
    }
    
    // Create a new lock for this operation
    let releaseLock: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    
    this.locks.set(repoPath, lockPromise)
    
    try {
      // Execute the operation
      const result = await operation()
      return result
    } finally {
      // Release the lock
      releaseLock!()
      
      // Clean up if this is the current lock
      if (this.locks.get(repoPath) === lockPromise) {
        this.locks.delete(repoPath)
      }
    }
  }
}

export const gitLock = new GitOperationLock()