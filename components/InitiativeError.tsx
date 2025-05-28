'use client';

import React from 'react';
import { AlertCircle, RefreshCw, ChevronDown, Info, Home } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ErrorCode, getUserFriendlyMessage } from '@/lib/utils/errors';

interface InitiativeErrorProps {
  error: {
    message: string;
    code?: string;
    timestamp?: string;
    recoverable?: boolean;
    context?: any;
  };
  initiativeId?: string;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function InitiativeError({ 
  error, 
  initiativeId,
  onRetry, 
  onCancel 
}: InitiativeErrorProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Get user-friendly message
  const friendlyMessage = error.code 
    ? getUserFriendlyMessage({ code: error.code as ErrorCode } as any)
    : error.message;
  
  // Determine error severity
  const isRecoverable = error.recoverable !== false;
  const variant = isRecoverable ? 'default' : 'destructive';
  
  // Get recovery suggestions based on error code
  const getRecoverySuggestions = (code?: string): string[] => {
    switch (code) {
      case ErrorCode.PROCESS_TIMEOUT:
        return [
          'The operation is taking longer than expected',
          'Try breaking down your request into smaller parts',
          'Check if Claude Code is responding in other terminals'
        ];
      case ErrorCode.CLAUDE_OUTPUT_MALFORMED:
        return [
          'Claude Code produced unexpected output',
          'Try rephrasing your request',
          'Ensure your prompt is clear and specific'
        ];
      case ErrorCode.GIT_UNCOMMITTED_CHANGES:
        return [
          'You have uncommitted changes in your repository',
          'Commit or stash your changes before proceeding',
          'Use "git status" to see what changed'
        ];
      case ErrorCode.CONCURRENT_MODIFICATION:
        return [
          'Another operation is modifying this resource',
          'Wait a moment and try again',
          'Check if another initiative is running'
        ];
      case ErrorCode.NETWORK_ERROR:
        return [
          'Check your internet connection',
          'Verify Claude Code API is accessible',
          'Try again in a few moments'
        ];
      default:
        return [];
    }
  };
  
  const suggestions = getRecoverySuggestions(error.code);
  
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">
              {isRecoverable ? 'Operation Failed' : 'Error Occurred'}
            </CardTitle>
          </div>
          {error.timestamp && (
            <span className="text-xs text-muted-foreground">
              {new Date(error.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        <CardDescription>
          {friendlyMessage}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {suggestions.length > 0 && (
          <Alert variant={variant}>
            <Info className="h-4 w-4" />
            <AlertTitle>Suggestions</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-1 text-sm">
                {suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        
        {isDevelopment && (error.context || error.code) && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span>Technical Details</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-lg bg-muted p-4 text-xs font-mono space-y-2">
                {error.code && (
                  <div>
                    <span className="text-muted-foreground">Error Code:</span> {error.code}
                  </div>
                )}
                {initiativeId && (
                  <div>
                    <span className="text-muted-foreground">Initiative ID:</span> {initiativeId}
                  </div>
                )}
                {error.context && (
                  <div>
                    <span className="text-muted-foreground">Context:</span>
                    <pre className="mt-1 overflow-auto">
                      {JSON.stringify(error.context, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        
        <div className="flex gap-2">
          {isRecoverable && onRetry && (
            <Button onClick={onRetry} variant="default" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
          {onCancel && (
            <Button onClick={onCancel} variant="outline" size="sm">
              Cancel
            </Button>
          )}
          {!onRetry && !onCancel && (
            <Button
              onClick={() => window.location.href = '/initiatives'}
              variant="outline"
              size="sm"
            >
              <Home className="mr-2 h-4 w-4" />
              Back to Initiatives
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline error display for smaller error states
 */
export function InlineError({ 
  error,
  onRetry,
  className = ''
}: {
  error: string | { message: string; code?: string };
  onRetry?: () => void;
  className?: string;
}) {
  const message = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'object' ? error.code : undefined;
  
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>{message}</span>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
            className="ml-4"
          >
            <RefreshCw className="mr-2 h-3 w-3" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}