/**
 * Error recovery workflows for the initiative system
 */

import { 
  AppError, 
  ErrorCode,
  InitiativeError,
  ProcessError,
  ClaudeCodeError,
  toAppError
} from './errors';
import { withRetry, ErrorRecovery, RecoveryStrategy } from './error-handler';
import { ProcessManager } from './process-manager';
import initiativeStore from './initiative-store';
import { InitiativeTransaction } from './rollback-manager';
import { InitiativePhase, Initiative as StoreInitiative, InitiativeStatus } from '../types/initiative';

/**
 * Recovery strategy for process failures
 */
export class ProcessRecoveryStrategy implements RecoveryStrategy<void> {
  constructor(
    private initiativeId: string
  ) {}

  canRecover(error: AppError): boolean {
    return (
      error instanceof ProcessError &&
      [
        ErrorCode.PROCESS_SPAWN_FAILED,
        ErrorCode.PROCESS_EXIT_ERROR,
        ErrorCode.PROCESS_TIMEOUT
      ].includes(error.code)
    );
  }

  async recover(error: AppError): Promise<void> {
    console.log(`Attempting to recover from process error: ${error.message}`);
    
    // For now, we'll just update the initiative state to allow retry
    // The actual process management is handled by the InitiativeProcessor

    // Wait a bit before retrying
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update initiative state to allow retry
    const initiative = initiativeStore.get(this.initiativeId);
    
    if (initiative) {
      // Store error in lastError field instead of status
      initiative.lastError = error.message;
      initiativeStore.update(this.initiativeId, initiative);
    }
  }
}

/**
 * Recovery strategy for Claude Code output parsing errors
 */
export class ClaudeOutputRecoveryStrategy implements RecoveryStrategy<any> {
  constructor(private initiativeId: string) {}

  canRecover(error: AppError): boolean {
    return error.code === ErrorCode.CLAUDE_OUTPUT_MALFORMED;
  }

  async recover(error: AppError): Promise<any> {
    console.log(`Attempting to recover from Claude output error: ${error.message}`);
    
    // Try to extract any valid JSON from the output
    const output = error.context.output as string;
    if (!output) throw error;

    // Try different parsing strategies
    const strategies = [
      // Strategy 1: Find JSON objects in the output
      () => {
        const jsonMatches = output.match(/\{[\s\S]*\}/g);
        if (jsonMatches) {
          for (const match of jsonMatches) {
            try {
              return JSON.parse(match);
            } catch {}
          }
        }
        throw new Error('No valid JSON found');
      },
      
      // Strategy 2: Extract from markdown code blocks
      () => {
        const codeBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          return JSON.parse(codeBlockMatch[1]);
        }
        throw new Error('No JSON code block found');
      },
      
      // Strategy 3: Try to fix common JSON errors
      () => {
        let fixed = output;
        // Remove trailing commas
        fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        // Add missing quotes to keys
        fixed = fixed.replace(/(\w+):/g, '"$1":');
        // Try parsing
        return JSON.parse(fixed);
      }
    ];

    for (const strategy of strategies) {
      try {
        return strategy();
      } catch {}
    }

    throw error; // Recovery failed
  }
}

/**
 * Recovery strategy for initiative state errors
 */
export class InitiativeStateRecoveryStrategy implements RecoveryStrategy<StoreInitiative> {

  canRecover(error: AppError): boolean {
    return error.code === ErrorCode.INITIATIVE_INVALID_STATE;
  }

  async recover(error: AppError): Promise<StoreInitiative> {
    const initiativeId = error.context.initiativeId as string;
    const currentState = error.context.currentState as string;
    
    console.log(`Attempting to recover initiative ${initiativeId} from invalid state: ${currentState}`);
    
    const initiative = initiativeStore.get(initiativeId);
    if (!initiative) {
      throw new Error('Initiative not found');
    }

    // Determine recovery action based on current state
    switch (currentState) {
      case InitiativeStatus.EXPLORING:
      case InitiativeStatus.RESEARCHING:
      case InitiativeStatus.PLANNING:
        // Check if process is marked as active
        if (!initiative.isActive) {
          // No process running, keep current status
          initiativeStore.update(initiativeId, initiative);
        }
        break;
        
      case InitiativeStatus.AWAITING_ANSWERS:
      case InitiativeStatus.AWAITING_RESEARCH:
        // These are valid waiting states, no action needed
        break;
        
      default:
        // For other states, try to determine the correct state
        // based on available data
        // Reset to beginning if we can't determine state
        if (initiative.currentPhase === InitiativePhase.RESEARCH_PREP) {
          initiative.currentPhase = InitiativePhase.QUESTIONS;
          initiative.status = InitiativeStatus.AWAITING_ANSWERS;
        } else if (initiative.currentPhase === InitiativePhase.QUESTIONS) {
          initiative.status = InitiativeStatus.AWAITING_ANSWERS;
        } else if (initiative.currentPhase === InitiativePhase.RESEARCH_REVIEW) {
          initiative.status = InitiativeStatus.AWAITING_RESEARCH;
        } else if (initiative.currentPhase === InitiativePhase.TASK_GENERATION) {
          initiative.status = InitiativeStatus.READY_FOR_TASKS;
        } else {
          // Reset to beginning if we can't determine state
          initiative.currentPhase = InitiativePhase.EXPLORATION;
          initiative.status = InitiativeStatus.EXPLORING;
        }
        initiativeStore.update(initiativeId, initiative);
    }

    return initiative;
  }
}

/**
 * Main recovery orchestrator for initiatives
 */
export class InitiativeRecovery {
  private recovery: ErrorRecovery<any>;
  private transaction: InitiativeTransaction;

  constructor(private initiativeId: string) {
    this.recovery = new ErrorRecovery();
    this.transaction = new InitiativeTransaction(initiativeId);
    this.setupRecoveryStrategies();
  }

  private setupRecoveryStrategies(): void {
    this.recovery
      .addStrategy(new ProcessRecoveryStrategy(this.initiativeId))
      .addStrategy(new ClaudeOutputRecoveryStrategy(this.initiativeId))
      .addStrategy(new InitiativeStateRecoveryStrategy());
  }

  /**
   * Execute an operation with recovery
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      rollbackOnFailure?: boolean;
      fallback?: () => Promise<T>;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, rollbackOnFailure = true, fallback } = options;

    try {
      // Execute with retry
      const result = await withRetry(
        async () => {
          return await this.recovery.execute(operation, fallback);
        },
        {
          maxRetries,
          onRetry: (error, attempt) => {
            console.log(`Retry attempt ${attempt} for initiative ${this.initiativeId}:`, error.message);
          }
        }
      );

      // Commit transaction on success
      this.transaction.commit();
      return result;

    } catch (error) {
      // Rollback on failure if requested
      if (rollbackOnFailure) {
        try {
          await this.transaction.rollback();
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
      }

      throw error;
    }
  }

  /**
   * Add a rollback action
   */
  addRollback(id: string, description: string, action: () => Promise<void>): void {
    this.transaction.addRollback(id, description, action);
  }

  /**
   * Save initiative state for rollback
   */
  saveState(state: any): void {
    this.transaction.saveInitiativeState(state);
  }

  /**
   * Recover from a specific error
   */
  async recoverFromError(error: unknown): Promise<void> {
    const appError = toAppError(error);
    
    // Update initiative with error info
    const initiative = initiativeStore.get(this.initiativeId);
    
    if (initiative) {
      // Store error in lastError field
      initiative.lastError = appError.message;
      initiativeStore.update(this.initiativeId, initiative);
    }

    // Attempt recovery
    if (this.isRecoverable(appError)) {
      await this.recovery.execute(
        async () => {
          throw appError;
        },
        async () => {
          // Fallback: reset initiative to safe state
          if (initiative) {
            // Reset to appropriate status based on phase
            if (initiative.currentPhase === 'questions') {
              initiative.status = InitiativeStatus.AWAITING_ANSWERS;
            } else if (initiative.currentPhase === 'research_review') {
              initiative.status = InitiativeStatus.AWAITING_RESEARCH;
            } else if (initiative.currentPhase === 'task_generation' || initiative.currentPhase === 'ready') {
              initiative.status = InitiativeStatus.READY_FOR_TASKS;
            } else {
              initiative.status = InitiativeStatus.EXPLORING;
            }
            // Clear error
            initiative.lastError = undefined;
            initiativeStore.update(this.initiativeId, initiative);
          }
        }
      );
    }
  }

  /**
   * Check if an error is recoverable
   */
  private isRecoverable(error: AppError): boolean {
    const recoverableCodes = [
      ErrorCode.PROCESS_TIMEOUT,
      ErrorCode.NETWORK_TIMEOUT,
      ErrorCode.CLAUDE_OUTPUT_MALFORMED,
      ErrorCode.INITIATIVE_INVALID_STATE,
      ErrorCode.CONCURRENT_MODIFICATION
    ];

    return recoverableCodes.includes(error.code);
  }
}

/**
 * Recovery workflow for common scenarios
 */
export class RecoveryWorkflows {
  /**
   * Recover from process crash during initiative phase
   */
  static async recoverFromProcessCrash(
    initiativeId: string,
    phase: InitiativePhase
  ): Promise<void> {
    // Note: Process cleanup is handled by InitiativeProcessor
    // which manages the Claude Code processes

    // Reset initiative to ready state
    const initiative = initiativeStore.get(initiativeId);
    if (initiative) {
      // Reset to appropriate status based on phase
      if (initiative.currentPhase === InitiativePhase.QUESTIONS) {
        initiative.status = InitiativeStatus.AWAITING_ANSWERS;
      } else if (initiative.currentPhase === InitiativePhase.RESEARCH_REVIEW) {
        initiative.status = InitiativeStatus.AWAITING_RESEARCH;
      } else if (initiative.currentPhase === InitiativePhase.TASK_GENERATION || initiative.currentPhase === InitiativePhase.READY) {
        initiative.status = InitiativeStatus.READY_FOR_TASKS;
      } else {
        initiative.status = InitiativeStatus.EXPLORING;
      }
      initiative.lastError = 'Process crashed, ready to retry';
      initiativeStore.update(initiativeId, initiative);
    }
  }

  /**
   * Recover from concurrent modification
   */
  static async recoverFromConcurrentModification(
    initiativeId: string
  ): Promise<void> {
    // Wait for lock to be released
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
      try {
        const initiative = initiativeStore.get(initiativeId);
        if (initiative && !initiative.isActive) {
          return; // Lock released
        }
      } catch {}
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }

    // Force unlock if still locked
    const initiative = initiativeStore.get(initiativeId);
    if (initiative && initiative.isActive) {
      initiative.isActive = false;
      initiativeStore.update(initiativeId, initiative);
    }
  }

  /**
   * Recover from incomplete phase transition
   */
  static async recoverFromIncompleteTransition(
    initiativeId: string,
    fromPhase: InitiativePhase,
    toPhase: InitiativePhase
  ): Promise<void> {
    const initiative = initiativeStore.get(initiativeId);
    
    if (!initiative) return;

    // Check if transition actually completed
    const hasDataForPhase = (phase: InitiativePhase): boolean => {
      switch (phase) {
        case 'exploration':
          return !!initiative.questions && initiative.questions.length > 0;
        case 'questions':
          return !!initiative.userAnswers && Object.keys(initiative.userAnswers).length > 0;
        case 'research_prep':
          return !!initiative.researchNeeds;
        case 'research_review':
          return !!initiative.researchResults;
        case 'task_generation':
          return !!initiative.taskSteps && initiative.taskSteps.length > 0;
        case 'ready':
          return (initiative.submittedTasks ?? 0) > 0;
        default:
          return false;
      }
    };

    // Determine correct phase
    if (hasDataForPhase(toPhase)) {
      initiative.currentPhase = toPhase;
    } else {
      initiative.currentPhase = fromPhase;
    }
    
    // Set appropriate status based on phase
    if (initiative.currentPhase === 'questions') {
      initiative.status = InitiativeStatus.AWAITING_ANSWERS;
    } else if (initiative.currentPhase === 'research_review') {
      initiative.status = InitiativeStatus.AWAITING_RESEARCH;
    } else if (initiative.currentPhase === 'task_generation' || initiative.currentPhase === 'ready') {
      initiative.status = InitiativeStatus.READY_FOR_TASKS;
    } else {
      initiative.status = InitiativeStatus.EXPLORING;
    }
    initiativeStore.update(initiativeId, initiative);
  }
}