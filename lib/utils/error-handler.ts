/**
 * Error handling utilities and middleware
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  AppError,
  toAppError,
  getUserFriendlyMessage,
  serializeError,
  isOperationalError
} from './errors';

/**
 * Global error logger
 */
export class ErrorLogger {
  private static instance: ErrorLogger;
  private errors: Array<{ error: object; timestamp: Date }> = [];
  private maxErrors = 1000;

  private constructor() {}

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  log(error: Error, context?: any): void {
    const serialized = serializeError(error);
    const entry = {
      error: { ...serialized, context },
      timestamp: new Date()
    };

    this.errors.push(entry);
    
    // Keep only recent errors
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorLogger]', entry);
    }
  }

  getRecentErrors(count: number = 50): Array<{ error: object; timestamp: Date }> {
    return this.errors.slice(-count);
  }

  clear(): void {
    this.errors = [];
  }
}

/**
 * API error response handler
 */
export function handleApiError(error: unknown, request?: NextRequest): NextResponse {
  const appError = toAppError(error);
  const logger = ErrorLogger.getInstance();
  
  // Log the error
  logger.log(appError, {
    url: request?.url,
    method: request?.method,
    headers: request?.headers ? Object.fromEntries(request.headers.entries()) : undefined
  });

  // Don't expose internal errors in production
  const isProduction = process.env.NODE_ENV === 'production';
  const showDetails = !isProduction || isOperationalError(appError);

  const response = {
    error: {
      message: getUserFriendlyMessage(appError),
      code: appError.code,
      ...(showDetails && {
        details: appError.message,
        context: appError.context
      }),
      ...(!isProduction && {
        stack: appError.stack
      })
    }
  };

  return NextResponse.json(response, { status: appError.statusCode });
}

/**
 * Async handler wrapper for API routes
 */
export function withErrorHandler<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      const request = args.find(arg => arg instanceof NextRequest);
      return handleApiError(error, request);
    }
  }) as T;
}

/**
 * Retry mechanism with exponential backoff
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryableErrors?: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    retryableErrors = ['NETWORK_ERROR', 'NETWORK_TIMEOUT', 'PROCESS_TIMEOUT'],
    onRetry
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const appError = toAppError(error);
      
      // Check if error is retryable
      const isRetryable = retryableErrors.includes(appError.code);
      
      if (attempt === maxRetries || !isRetryable) {
        throw error;
      }

      // Call retry callback
      if (onRetry) {
        onRetry(appError, attempt + 1);
      }

      // Wait with exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError!;
}

/**
 * Circuit breaker pattern for handling repeated failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime?: Date;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000, // 1 minute
    private readonly name: string = 'default'
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const now = new Date();
      const timeSinceLastFailure = this.lastFailureTime
        ? now.getTime() - this.lastFailureTime.getTime()
        : Infinity;

      if (timeSinceLastFailure > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new AppError(
          `Circuit breaker is open for ${this.name}`,
          'CIRCUIT_BREAKER_OPEN' as any,
          503
        );
      }
    }

    try {
      const result = await operation();
      
      if (this.state === 'half-open') {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.warn(`Circuit breaker opened for ${this.name} after ${this.failures} failures`);
    }
  }

  private reset(): void {
    this.failures = 0;
    this.lastFailureTime = undefined;
    this.state = 'closed';
    console.info(`Circuit breaker reset for ${this.name}`);
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Error recovery strategies
 */
export interface RecoveryStrategy<T> {
  canRecover(error: AppError): boolean;
  recover(error: AppError): Promise<T>;
}

export class ErrorRecovery<T> {
  private strategies: RecoveryStrategy<T>[] = [];

  addStrategy(strategy: RecoveryStrategy<T>): this {
    this.strategies.push(strategy);
    return this;
  }

  async execute(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const appError = toAppError(error);
      
      // Try recovery strategies
      for (const strategy of this.strategies) {
        if (strategy.canRecover(appError)) {
          try {
            return await strategy.recover(appError);
          } catch (recoveryError) {
            // Recovery failed, try next strategy
            continue;
          }
        }
      }
      
      // No recovery strategy worked, try fallback
      if (fallback) {
        return await fallback();
      }
      
      // Re-throw original error
      throw error;
    }
  }
}

/**
 * Error telemetry for monitoring
 */
export interface ErrorTelemetry {
  errorCount: number;
  errorsByCode: Record<string, number>;
  errorRate: number;
  lastError?: {
    error: object;
    timestamp: Date;
  };
}

export class ErrorMonitor {
  private static instance: ErrorMonitor;
  private errorCounts: Map<string, number> = new Map();
  private windowStart: Date = new Date();
  private windowSize: number = 60000; // 1 minute

  private constructor() {}

  static getInstance(): ErrorMonitor {
    if (!ErrorMonitor.instance) {
      ErrorMonitor.instance = new ErrorMonitor();
    }
    return ErrorMonitor.instance;
  }

  recordError(error: AppError): void {
    const count = this.errorCounts.get(error.code) || 0;
    this.errorCounts.set(error.code, count + 1);
  }

  getTelemetry(): ErrorTelemetry {
    const now = new Date();
    const windowAge = now.getTime() - this.windowStart.getTime();
    
    // Reset window if needed
    if (windowAge > this.windowSize) {
      this.errorCounts.clear();
      this.windowStart = now;
    }

    const errorsByCode: Record<string, number> = {};
    let totalErrors = 0;

    for (const [code, count] of this.errorCounts.entries()) {
      errorsByCode[code] = count;
      totalErrors += count;
    }

    const logger = ErrorLogger.getInstance();
    const recentErrors = logger.getRecentErrors(1);

    return {
      errorCount: totalErrors,
      errorsByCode,
      errorRate: totalErrors / (windowAge / 1000), // errors per second
      lastError: recentErrors[0]
    };
  }

  reset(): void {
    this.errorCounts.clear();
    this.windowStart = new Date();
  }
}