import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { InitiativeValidationSkeleton } from '@/components/InitiativeSkeletons'

interface ValidationError {
  field: string
  message: string
  constraint: string
  details?: string
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

interface ValidationReport {
  timestamp: string
  initiativeId: string
  phase: string
  validation: ValidationResult
  recommendations: string[]
}

interface InitiativeValidationProps {
  initiativeId: string
  phase: string
  onValidationComplete?: (valid: boolean) => void
  showDetails?: boolean
}

export function InitiativeValidation({ 
  initiativeId, 
  phase, 
  onValidationComplete,
  showDetails = false 
}: InitiativeValidationProps) {
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const fetchValidation = async () => {
    if (!initiativeId) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/initiatives/${initiativeId}/validation`)
      if (!response.ok) {
        throw new Error('Failed to fetch validation')
      }
      
      const data = await response.json()
      setValidation(data.validation)
      setReport(data.report)
      
      if (onValidationComplete) {
        onValidationComplete(data.validation.valid)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate initiative')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchValidation()
  }, [initiativeId, phase])

  if (isLoading) {
    return <InitiativeValidationSkeleton />
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Validation Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!validation) return null

  // Don't show anything if valid and no warnings
  if (validation.valid && validation.warnings.length === 0 && !showDetails) {
    return null
  }

  const hasErrors = validation.errors.length > 0
  const hasWarnings = validation.warnings.length > 0

  return (
    <div className="space-y-4">
      {/* Summary Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {hasErrors ? (
            <Badge variant="destructive" className="flex items-center space-x-1">
              <AlertCircle className="h-3 w-3" />
              <span>{validation.errors.length} Error{validation.errors.length !== 1 ? 's' : ''}</span>
            </Badge>
          ) : hasWarnings ? (
            <Badge variant="secondary" className="flex items-center space-x-1">
              <AlertTriangle className="h-3 w-3" />
              <span>{validation.warnings.length} Warning{validation.warnings.length !== 1 ? 's' : ''}</span>
            </Badge>
          ) : (
            <Badge variant="default" className="flex items-center space-x-1">
              <CheckCircle className="h-3 w-3" />
              <span>Valid</span>
            </Badge>
          )}
          
          {(hasErrors || hasWarnings || showDetails) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs"
            >
              {isExpanded ? 'Hide' : 'Show'} Details
            </Button>
          )}
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchValidation}
          className="text-xs"
        >
          Refresh
        </Button>
      </div>

      {/* Detailed View */}
      {isExpanded && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Validation Report</CardTitle>
            <CardDescription className="text-xs">
              Phase: {phase} • {new Date(report?.timestamp || '').toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Errors */}
            {hasErrors && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive">Errors</h4>
                {validation.errors.map((error, idx) => (
                  <Alert key={idx} variant="destructive" className="py-2">
                    <AlertCircle className="h-4 w-4" />
                    <div className="ml-2">
                      <AlertDescription className="text-xs">
                        <strong>{error.field}:</strong> {error.message}
                        {error.details && (
                          <span className="text-muted-foreground ml-1">({error.details})</span>
                        )}
                      </AlertDescription>
                    </div>
                  </Alert>
                ))}
              </div>
            )}

            {/* Warnings */}
            {hasWarnings && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-yellow-600">Warnings</h4>
                {validation.warnings.map((warning, idx) => (
                  <Alert key={idx} className="py-2 border-yellow-200 bg-yellow-50">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <AlertDescription className="text-xs ml-2">
                      {warning}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {report?.recommendations && report.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-blue-600">Recommendations</h4>
                {report.recommendations.map((rec, idx) => (
                  <Alert key={idx} className="py-2 border-blue-200 bg-blue-50">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs ml-2">
                      {rec}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Inline validation component for forms
export function InlineValidation({ 
  field, 
  value, 
  validator,
  className = "" 
}: { 
  field: string
  value: any
  validator: (value: any) => { valid: boolean; error?: string }
  className?: string 
}) {
  const [validation, setValidation] = useState<{ valid: boolean; error?: string } | null>(null)

  useEffect(() => {
    if (value !== undefined && value !== null && value !== '') {
      const result = validator(value)
      setValidation(result)
    } else {
      setValidation(null)
    }
  }, [value, validator])

  if (!validation || validation.valid) return null

  return (
    <p className={`text-xs text-destructive mt-1 ${className}`}>
      {validation.error}
    </p>
  )
}