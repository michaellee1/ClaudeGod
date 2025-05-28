/**
 * Rollback manager for handling failed operations
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { AppError } from './errors';

export interface RollbackAction {
  id: string;
  description: string;
  execute: () => Promise<void>;
  timestamp: Date;
}

export interface Checkpoint {
  id: string;
  description: string;
  data: any;
  timestamp: Date;
}

/**
 * Manages rollback operations for transactional behavior
 */
export class RollbackManager {
  private actions: RollbackAction[] = [];
  private checkpoints: Map<string, Checkpoint> = new Map();
  private executed: boolean = false;

  /**
   * Add a rollback action
   */
  addAction(id: string, description: string, action: () => Promise<void>): void {
    if (this.executed) {
      throw new Error('Cannot add actions after rollback has been executed');
    }

    this.actions.push({
      id,
      description,
      execute: action,
      timestamp: new Date()
    });
  }

  /**
   * Create a checkpoint for state restoration
   */
  createCheckpoint(id: string, description: string, data: any): void {
    this.checkpoints.set(id, {
      id,
      description,
      data: JSON.parse(JSON.stringify(data)), // Deep clone
      timestamp: new Date()
    });
  }

  /**
   * Get checkpoint data
   */
  getCheckpoint(id: string): any | undefined {
    return this.checkpoints.get(id)?.data;
  }

  /**
   * Execute all rollback actions in reverse order
   */
  async rollback(): Promise<void> {
    if (this.executed) {
      throw new Error('Rollback has already been executed');
    }

    this.executed = true;
    const errors: Error[] = [];

    // Execute actions in reverse order
    const reversedActions = [...this.actions].reverse();

    for (const action of reversedActions) {
      try {
        console.log(`Executing rollback: ${action.description}`);
        await action.execute();
      } catch (error) {
        console.error(`Rollback action failed: ${action.description}`, error);
        errors.push(error as Error);
      }
    }

    if (errors.length > 0) {
      throw new AppError(
        `Rollback completed with ${errors.length} errors`,
        'ROLLBACK_PARTIAL_FAILURE' as any,
        500,
        true,
        { errors: errors.map(e => e.message) }
      );
    }
  }

  /**
   * Clear all actions and checkpoints
   */
  clear(): void {
    this.actions = [];
    this.checkpoints.clear();
    this.executed = false;
  }

  /**
   * Get rollback status
   */
  getStatus(): {
    actionCount: number;
    checkpointCount: number;
    executed: boolean;
    actions: Array<{ id: string; description: string; timestamp: Date }>;
  } {
    return {
      actionCount: this.actions.length,
      checkpointCount: this.checkpoints.size,
      executed: this.executed,
      actions: this.actions.map(a => ({
        id: a.id,
        description: a.description,
        timestamp: a.timestamp
      }))
    };
  }
}

/**
 * File-based rollback utilities
 */
export class FileRollback {
  private backupDir: string;
  private backups: Map<string, string> = new Map();

  constructor(backupDir: string = '/tmp/claude-god-backups') {
    this.backupDir = backupDir;
  }

  /**
   * Backup a file before modification
   */
  async backupFile(filePath: string): Promise<void> {
    try {
      // Create backup directory if it doesn't exist
      await fs.mkdir(this.backupDir, { recursive: true });

      // Generate backup filename
      const timestamp = Date.now();
      const basename = path.basename(filePath);
      const backupPath = path.join(this.backupDir, `${timestamp}-${basename}`);

      // Copy file to backup location
      const content = await fs.readFile(filePath, 'utf-8');
      await fs.writeFile(backupPath, content);

      // Store mapping
      this.backups.set(filePath, backupPath);
    } catch (error) {
      // If file doesn't exist, that's okay - nothing to backup
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Restore a file from backup
   */
  async restoreFile(filePath: string): Promise<void> {
    const backupPath = this.backups.get(filePath);
    if (!backupPath) {
      throw new Error(`No backup found for file: ${filePath}`);
    }

    try {
      const content = await fs.readFile(backupPath, 'utf-8');
      await fs.writeFile(filePath, content);
    } catch (error) {
      throw new AppError(
        `Failed to restore file: ${filePath}`,
        'FILE_RESTORE_FAILED' as any,
        500,
        true,
        { filePath, backupPath, error: (error as Error).message }
      );
    }
  }

  /**
   * Delete a file (with ability to restore)
   */
  async deleteFileWithBackup(filePath: string): Promise<void> {
    await this.backupFile(filePath);
    await fs.unlink(filePath);
  }

  /**
   * Clean up old backups
   */
  async cleanup(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup backups:', error);
    }
  }
}

/**
 * Transaction wrapper for operations with automatic rollback
 */
export class Transaction {
  private rollbackManager: RollbackManager;
  private fileRollback: FileRollback;

  constructor() {
    this.rollbackManager = new RollbackManager();
    this.fileRollback = new FileRollback();
  }

  /**
   * Add a rollback action
   */
  addRollback(id: string, description: string, action: () => Promise<void>): void {
    this.rollbackManager.addAction(id, description, action);
  }

  /**
   * Create a checkpoint
   */
  checkpoint(id: string, description: string, data: any): void {
    this.rollbackManager.createCheckpoint(id, description, data);
  }

  /**
   * Get checkpoint data
   */
  getCheckpoint(id: string): any | undefined {
    return this.rollbackManager.getCheckpoint(id);
  }

  /**
   * Backup a file before modification
   */
  async backupFile(filePath: string): Promise<void> {
    await this.fileRollback.backupFile(filePath);
    this.addRollback(
      `restore-${filePath}`,
      `Restore file: ${filePath}`,
      async () => {
        await this.fileRollback.restoreFile(filePath);
      }
    );
  }

  /**
   * Execute a transaction with automatic rollback on failure
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.commit();
      return result;
    } catch (error) {
      console.error('Transaction failed, rolling back...', error);
      await this.rollback();
      throw error;
    }
  }

  /**
   * Commit the transaction (clear rollback actions)
   */
  commit(): void {
    this.rollbackManager.clear();
    // Note: We keep file backups for manual recovery if needed
  }

  /**
   * Rollback the transaction
   */
  async rollback(): Promise<void> {
    await this.rollbackManager.rollback();
  }

  /**
   * Get transaction status
   */
  getStatus(): any {
    return this.rollbackManager.getStatus();
  }
}

/**
 * Initiative-specific transaction helper
 */
export class InitiativeTransaction extends Transaction {
  private initiativeId: string;
  private originalState: any;

  constructor(initiativeId: string) {
    super();
    this.initiativeId = initiativeId;
  }

  /**
   * Save the current initiative state for rollback
   */
  saveInitiativeState(state: any): void {
    this.originalState = JSON.parse(JSON.stringify(state));
    this.checkpoint('initiative-state', 'Original initiative state', state);
  }

  /**
   * Create standard rollback actions for initiative operations
   */
  setupStandardRollbacks(dataDir: string): void {
    // Rollback for directory creation
    this.addRollback(
      'remove-initiative-dir',
      `Remove initiative directory: ${dataDir}`,
      async () => {
        try {
          await fs.rm(dataDir, { recursive: true, force: true });
        } catch (error) {
          console.error('Failed to remove initiative directory:', error);
        }
      }
    );
  }

  /**
   * Add process cleanup rollback
   */
  addProcessCleanup(processId: string, cleanup: () => Promise<void>): void {
    this.addRollback(
      `cleanup-process-${processId}`,
      `Cleanup process: ${processId}`,
      cleanup
    );
  }
}