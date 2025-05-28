'use client';

import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      errorInfo
    });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log to error tracking service in production
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send to error tracking service
      fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack
          },
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href
        })
      }).catch(err => console.error('Failed to log error:', err));
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      const isDevelopment = process.env.NODE_ENV === 'development';

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <CardTitle>Something went wrong</CardTitle>
              </div>
              <CardDescription>
                An unexpected error occurred. The error has been logged and we&apos;ll look into it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Details</AlertTitle>
                <AlertDescription className="mt-2">
                  <p className="font-mono text-sm">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                  {isDevelopment && this.state.error?.stack && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Stack trace (development only)
                      </summary>
                      <pre className="mt-2 text-xs overflow-auto p-2 bg-muted rounded">
                        {this.state.error.stack}
                      </pre>
                    </details>
                  )}
                  {isDevelopment && this.state.errorInfo?.componentStack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        Component stack (development only)
                      </summary>
                      <pre className="mt-2 text-xs overflow-auto p-2 bg-muted rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button onClick={this.handleReset} variant="default">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              <Button
                onClick={() => window.location.href = '/'}
                variant="outline"
              >
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Async error boundary for handling errors in async components
 */
export function AsyncErrorBoundary({ 
  children, 
  fallback,
  onError 
}: {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}) {
  return (
    <ErrorBoundary fallback={fallback} onError={onError}>
      {children}
    </ErrorBoundary>
  );
}

/**
 * Initiative-specific error boundary with retry logic
 */
export function InitiativeErrorBoundary({ 
  children,
  initiativeId,
  onRetry
}: {
  children: ReactNode;
  initiativeId?: string;
  onRetry?: () => void;
}) {
  return (
    <ErrorBoundary
      fallback={
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Initiative Error</AlertTitle>
          <AlertDescription>
            {initiativeId 
              ? `Failed to load initiative ${initiativeId}`
              : 'Failed to load initiative data'
            }
            {onRetry && (
              <Button
                onClick={onRetry}
                variant="outline"
                size="sm"
                className="mt-2"
              >
                <RefreshCw className="mr-2 h-3 w-3" />
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * HOC to wrap components with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  return (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );
}