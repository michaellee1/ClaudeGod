import fs from 'fs/promises'
import path from 'path'

export interface FileOperation {
  type: 'write' | 'delete' | 'rename'
  path: string
  backupPath?: string
  originalContent?: string
}

export class FileRecovery {
  private operations: FileOperation[] = []
  private tempDir: string

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.env.TMPDIR || '/tmp', 'claude-god-recovery')
  }

  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true })
    } catch (error) {
      console.error('Failed to create temp directory:', error)
    }
  }

  async backupFile(filePath: string): Promise<string | null> {
    try {
      await this.ensureTempDir()
      const backupName = `backup-${Date.now()}-${path.basename(filePath)}`
      const backupPath = path.join(this.tempDir, backupName)
      
      // Check if file exists before backing up
      try {
        await fs.access(filePath)
        await fs.copyFile(filePath, backupPath)
        return backupPath
      } catch {
        // File doesn't exist, no backup needed
        return null
      }
    } catch (error) {
      console.error(`Failed to backup file ${filePath}:`, error)
      return null
    }
  }

  async safeWriteFile(filePath: string, content: string): Promise<void> {
    const backupPath = await this.backupFile(filePath)
    
    this.operations.push({
      type: 'write',
      path: filePath,
      backupPath: backupPath || undefined
    })

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })
      
      // Write to temp file first with unique name
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`
      await fs.writeFile(tempPath, content, 'utf-8')
      
      // Atomic rename
      await fs.rename(tempPath, filePath)
    } catch (error) {
      // Rollback on error
      if (backupPath) {
        try {
          await fs.copyFile(backupPath, filePath)
        } catch (rollbackError) {
          console.error('Failed to rollback file write:', rollbackError)
        }
      }
      throw error
    }
  }

  async safeReadFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`)
      }
      throw error
    }
  }

  async safeDeleteFile(filePath: string): Promise<void> {
    const backupPath = await this.backupFile(filePath)
    
    this.operations.push({
      type: 'delete',
      path: filePath,
      backupPath: backupPath || undefined
    })

    try {
      await fs.unlink(filePath)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // Rollback on error (except if file doesn't exist)
        if (backupPath) {
          try {
            await fs.copyFile(backupPath, filePath)
          } catch (rollbackError) {
            console.error('Failed to rollback file deletion:', rollbackError)
          }
        }
        throw error
      }
    }
  }

  async rollbackAll(): Promise<void> {
    console.log(`Rolling back ${this.operations.length} file operations`)
    
    // Rollback in reverse order
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i]
      
      try {
        switch (op.type) {
          case 'write':
          case 'delete':
            if (op.backupPath) {
              await fs.copyFile(op.backupPath, op.path)
              console.log(`Rolled back: ${op.path}`)
            }
            break
        }
      } catch (error) {
        console.error(`Failed to rollback operation for ${op.path}:`, error)
      }
    }
  }

  async cleanup(): Promise<void> {
    // Clean up backup files
    for (const op of this.operations) {
      if (op.backupPath) {
        try {
          await fs.unlink(op.backupPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    
    // Clear operations
    this.operations = []
  }

  async readJsonFile<T>(filePath: string): Promise<T> {
    try {
      const content = await this.safeReadFile(filePath)
      return JSON.parse(content)
    } catch (error: any) {
      if (error.message?.includes('File not found')) {
        throw error
      }
      throw new Error(`Failed to parse JSON file ${filePath}: ${error.message}`)
    }
  }

  async writeJsonFile(filePath: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2)
    await this.safeWriteFile(filePath, content)
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      console.error(`Failed to create directory ${dirPath}:`, error)
      throw error
    }
  }
}

// Export class only, let consumers create their own instances
// to avoid potential conflicts with multiple instances