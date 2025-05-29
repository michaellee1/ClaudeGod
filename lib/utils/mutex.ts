export class Mutex {
  private locked = false
  private queue: (() => void)[] = []

  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve)
      })
    }
    
    this.locked = true
    
    return () => {
      this.locked = false
      const next = this.queue.shift()
      if (next) {
        next()
      }
    }
  }

  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await callback()
    } finally {
      release()
    }
  }
}