/**
 * Global error handler for client-side errors
 */

import { ErrorLogger } from './error-handler';
import { toAppError, serializeError } from './errors';

export class GlobalErrorHandler {
  private static instance: GlobalErrorHandler;
  private errorQueue: Array<{ error: any; timestamp: Date }> = [];
  private isReporting = false;

  private constructor() {
    this.setupHandlers();
  }

  static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler();
    }
    return GlobalErrorHandler.instance;
  }

  private setupHandlers(): void {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        this.handleError(event.reason, {
          type: 'unhandledrejection',
          promise: event.promise
        });
        event.preventDefault();
      });

      // Handle global errors
      window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        this.handleError(event.error || event.message, {
          type: 'error',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
        event.preventDefault();
      });

      // Report errors before page unload
      window.addEventListener('beforeunload', () => {
        if (this.errorQueue.length > 0) {
          this.flushErrors();
        }
      });
    }
  }

  private handleError(error: any, context: any): void {
    const appError = toAppError(error);
    
    this.errorQueue.push({
      error: {
        ...serializeError(appError),
        context
      },
      timestamp: new Date()
    });

    // Report errors in batches
    this.reportErrors();
  }

  private async reportErrors(): Promise<void> {
    if (this.isReporting || this.errorQueue.length === 0) {
      return;
    }

    this.isReporting = true;

    try {
      // Take a batch of errors
      const batch = this.errorQueue.splice(0, 10);
      
      await fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errors: batch,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      console.error('Failed to report errors:', error);
      // Put errors back in queue
      // Note: Be careful not to create infinite loop
    } finally {
      this.isReporting = false;
      
      // Report more errors if queue is not empty
      if (this.errorQueue.length > 0) {
        setTimeout(() => this.reportErrors(), 5000);
      }
    }
  }

  private flushErrors(): void {
    if (this.errorQueue.length === 0) return;

    // Use sendBeacon for reliability
    const data = JSON.stringify({
      errors: this.errorQueue,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });

    navigator.sendBeacon('/api/errors', data);
    this.errorQueue = [];
  }

  // Manual error reporting
  report(error: any, context?: any): void {
    this.handleError(error, context);
  }
}

// Initialize global error handler
if (typeof window !== 'undefined') {
  GlobalErrorHandler.getInstance();
}

// Export convenience function
export function reportError(error: any, context?: any): void {
  if (typeof window !== 'undefined') {
    GlobalErrorHandler.getInstance().report(error, context);
  }
}