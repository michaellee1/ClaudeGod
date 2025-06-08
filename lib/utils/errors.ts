/**
 * Custom error classes for the system
 */

export enum ErrorCode {
  // General errors
  UNKNOWN = 'UNKNOWN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  
  // Process errors
  PROCESS_SPAWN_FAILED = 'PROCESS_SPAWN_FAILED',
  PROCESS_TIMEOUT = 'PROCESS_TIMEOUT',
  PROCESS_EXIT_ERROR = 'PROCESS_EXIT_ERROR',
  PROCESS_PERMISSION_ERROR = 'PROCESS_PERMISSION_ERROR',
  PROCESS_MEMORY_ERROR = 'PROCESS_MEMORY_ERROR',
  
  // Git errors
  GIT_CONFLICT = 'GIT_CONFLICT',
  GIT_UNCOMMITTED_CHANGES = 'GIT_UNCOMMITTED_CHANGES',
  GIT_INVALID_REPO = 'GIT_INVALID_REPO',
  GIT_OPERATION_FAILED = 'GIT_OPERATION_FAILED',
  
  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_PERMISSION_ERROR = 'FILE_PERMISSION_ERROR',
  FILE_OPERATION_FAILED = 'FILE_OPERATION_FAILED',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  
  // Claude Code errors
  CLAUDE_OUTPUT_MALFORMED = 'CLAUDE_OUTPUT_MALFORMED',
  CLAUDE_PROCESS_CRASHED = 'CLAUDE_PROCESS_CRASHED',
  
  // Concurrent modification errors
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',
  LOCK_ACQUISITION_FAILED = 'LOCK_ACQUISITION_FAILED',
}

export interface ErrorContext {
  [key: string]: any;
}

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    statusCode: number = 500,
    isOperational: boolean = true,
    context: ErrorContext = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    this.timestamp = new Date();
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}


/**
 * Process-specific error classes
 */
export class ProcessError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PROCESS_EXIT_ERROR,
    context: ErrorContext = {}
  ) {
    super(message, code, 500, true, context);
  }
}

export class ProcessSpawnError extends ProcessError {
  constructor(command: string, error: any) {
    super(
      `Failed to spawn process: ${command}`,
      ErrorCode.PROCESS_SPAWN_FAILED,
      { command, originalError: error.message, errno: error.errno }
    );
  }
}

export class ProcessTimeoutError extends ProcessError {
  constructor(processId: string, timeout: number) {
    super(
      `Process timeout after ${timeout}ms`,
      ErrorCode.PROCESS_TIMEOUT,
      { processId, timeout }
    );
  }
}

/**
 * Git-specific error classes
 */
export class GitError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.GIT_OPERATION_FAILED,
    context: ErrorContext = {},
    statusCode: number = 500
  ) {
    super(message, code, statusCode, true, context);
  }
}

export class GitConflictError extends GitError {
  constructor(operation: string, details?: string) {
    super(
      `Git conflict during ${operation}${details ? `: ${details}` : ''}`,
      ErrorCode.GIT_CONFLICT,
      { operation, details },
      409
    );
  }
}

export class GitUncommittedChangesError extends GitError {
  constructor() {
    super(
      'Cannot perform operation: uncommitted changes exist',
      ErrorCode.GIT_UNCOMMITTED_CHANGES,
      {},
      400
    );
  }
}

/**
 * File system error classes
 */
export class FileSystemError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FILE_OPERATION_FAILED,
    context: ErrorContext = {},
    statusCode: number = 500
  ) {
    super(message, code, statusCode, true, context);
  }
}

export class FileNotFoundError extends FileSystemError {
  constructor(filePath: string) {
    super(
      `File not found: ${filePath}`,
      ErrorCode.FILE_NOT_FOUND,
      { filePath },
      404
    );
  }
}

/**
 * Network error classes
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NETWORK_ERROR,
    context: ErrorContext = {}
  ) {
    super(message, code, 500, true, context);
  }
}

/**
 * Claude Code error classes
 */
export class ClaudeCodeError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CLAUDE_PROCESS_CRASHED,
    context: ErrorContext = {}
  ) {
    super(message, code, 500, true, context);
  }
}

export class ClaudeOutputMalformedError extends ClaudeCodeError {
  constructor(output: string, parseError?: string) {
    super(
      `Malformed Claude Code output${parseError ? `: ${parseError}` : ''}`,
      ErrorCode.CLAUDE_OUTPUT_MALFORMED,
      { output: output.substring(0, 200), parseError }
    );
  }
}

/**
 * Validation error class
 */
export class ValidationError extends AppError {
  constructor(message: string, field?: string, value?: any) {
    super(
      message,
      ErrorCode.VALIDATION_ERROR,
      400,
      true,
      { field, value }
    );
  }
}

/**
 * Concurrent modification error
 */
export class ConcurrentModificationError extends AppError {
  constructor(resource: string, operation: string) {
    super(
      `Concurrent modification detected for ${resource} during ${operation}`,
      ErrorCode.CONCURRENT_MODIFICATION,
      409,
      true,
      { resource, operation }
    );
  }
}

/**
 * Error utility functions
 */

/**
 * Check if an error is operational (expected) vs programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  
  if (error instanceof Error) {
    // Handle specific Node.js errors
    const nodeError = error as any;
    
    if (nodeError.code === 'ENOENT') {
      return new FileNotFoundError(nodeError.path || 'unknown');
    }
    
    if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
      return new FileSystemError(
        `Permission denied: ${nodeError.path || 'unknown'}`,
        ErrorCode.FILE_PERMISSION_ERROR,
        { originalCode: nodeError.code, path: nodeError.path }
      );
    }
    
    if (nodeError.code === 'ENOMEM') {
      return new ProcessError(
        'Out of memory',
        ErrorCode.PROCESS_MEMORY_ERROR,
        { originalCode: nodeError.code }
      );
    }
    
    // Generic error conversion
    return new AppError(
      error.message || 'Unknown error',
      ErrorCode.UNKNOWN,
      500,
      false,
      { originalError: error.name, stack: error.stack }
    );
  }
  
  // Handle non-Error objects
  return new AppError(
    String(error),
    ErrorCode.UNKNOWN,
    500,
    false,
    { originalError: error }
  );
}

/**
 * Create user-friendly error message
 */
export function getUserFriendlyMessage(error: AppError): string {
  const messages: Partial<Record<ErrorCode, string>> = {
    [ErrorCode.PROCESS_TIMEOUT]: 'The operation took too long and was cancelled.',
    [ErrorCode.GIT_CONFLICT]: 'There are conflicts that need to be resolved manually.',
    [ErrorCode.GIT_UNCOMMITTED_CHANGES]: 'Please commit or stash your changes before proceeding.',
    [ErrorCode.FILE_NOT_FOUND]: 'The requested file could not be found.',
    [ErrorCode.FILE_PERMISSION_ERROR]: 'You don\'t have permission to access this file.',
    [ErrorCode.NETWORK_ERROR]: 'Network connection failed. Please check your connection and try again.',
    [ErrorCode.NETWORK_TIMEOUT]: 'The request timed out. Please try again.',
    [ErrorCode.CLAUDE_OUTPUT_MALFORMED]: 'Unable to parse Claude Code output. Please try again.',
    [ErrorCode.CONCURRENT_MODIFICATION]: 'Another operation is in progress. Please wait and try again.',
    [ErrorCode.VALIDATION_ERROR]: 'The provided data is invalid. Please check your input.',
  };
  
  return messages[error.code] || error.message;
}

/**
 * Error serializer for logging
 */
export function serializeError(error: Error): object {
  if (error instanceof AppError) {
    return error.toJSON();
  }
  
  return {
    ...error,
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}