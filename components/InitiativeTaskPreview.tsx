'use client'

import React, { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { InitiativeTask, InitiativeTaskStep } from '@/lib/types/initiative'
import { cn } from '@/lib/utils'

interface InitiativeTaskPreviewProps {
  steps: InitiativeTaskStep[]
  globalContext?: string
  onSubmitStep: (stepId: string, tasks: InitiativeTask[], thinkMode: string) => Promise<void>
  onRemoveTask: (stepId: string, taskId: string) => void
}

const THINK_MODES = [
  { value: 'planning', label: 'Planning' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'debugging', label: 'Debugging' }
]

export function InitiativeTaskPreview({
  steps = [],
  globalContext,
  onSubmitStep,
  onRemoveTask
}: InitiativeTaskPreviewProps) {
  const [thinkModes, setThinkModes] = useState<Record<string, string>>({})
  const [submittingSteps, setSubmittingSteps] = useState<Set<string>>(new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const getThinkMode = (stepId: string) => thinkModes[stepId] || 'planning'

  const setThinkMode = (stepId: string, mode: string) => {
    setThinkModes(prev => ({ ...prev, [stepId]: mode }))
  }

  const handleSubmitStep = async (step: InitiativeTaskStep) => {
    setSubmittingSteps(prev => new Set(prev).add(step.id))
    setErrors(prev => ({ ...prev, [step.id]: '' }))

    try {
      const thinkMode = getThinkMode(step.id)
      await onSubmitStep(step.id, step.tasks, thinkMode)
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        [step.id]: error instanceof Error ? error.message : 'Failed to submit step'
      }))
    } finally {
      setSubmittingSteps(prev => {
        const next = new Set(prev)
        next.delete(step.id)
        return next
      })
    }
  }

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }

  const getStepStatus = (step: InitiativeTaskStep) => {
    if (step.status === 'completed') return 'completed'
    if (submittingSteps.has(step.id)) return 'submitting'
    if (step.tasks.some(t => t.status === 'submitted')) return 'partial'
    return 'pending'
  }

  const getStatusBadgeVariant = (status: string): 'success' | 'purple' | 'secondary' | 'outline' => {
    switch (status) {
      case 'completed':
        return 'success'
      case 'submitting':
        return 'purple'
      case 'partial':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  return (
    <div className="space-y-6">
      {globalContext && (
        <Card>
          <CardHeader>
            <CardTitle>Global Context</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{globalContext}</p>
          </CardContent>
        </Card>
      )}

      {steps.map((step) => {
        const stepStatus = getStepStatus(step)
        const isSubmitting = submittingSteps.has(step.id)
        const pendingTasks = step.tasks.filter(t => t.status !== 'submitted')

        return (
          <Card key={step.id} className={cn(
            "transition-all",
            stepStatus === 'completed' && "opacity-75"
          )}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    Step {step.order}: {step.name}
                    <Badge variant={getStatusBadgeVariant(stepStatus)}>
                      {stepStatus === 'submitting' ? 'Submitting...' : stepStatus}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </div>
                <Badge variant="secondary" className="ml-4">
                  {pendingTasks.length} / {step.tasks.length} tasks
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {pendingTasks.length > 0 && (
                <div className="flex items-center gap-4">
                  <label htmlFor={`think-mode-${step.id}`} className="text-sm font-medium">
                    Think Mode:
                  </label>
                  <Select
                    id={`think-mode-${step.id}`}
                    value={getThinkMode(step.id)}
                    onChange={(e) => setThinkMode(step.id, e.target.value)}
                    disabled={isSubmitting}
                    className="w-48"
                  >
                    {THINK_MODES.map(mode => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="grid gap-3">
                {step.tasks.map((task) => {
                  const isExpanded = expandedTasks.has(task.id)
                  const isSubmitted = task.status === 'submitted'
                  const shouldTruncate = task.description.length > 150

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border bg-muted/50",
                        isSubmitted && "opacity-50"
                      )}
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm" title={task.title}>{task.title}</h4>
                          <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'default' : 'secondary'}>
                            {task.priority}
                          </Badge>
                          {isSubmitted && <Badge variant="success">Submitted</Badge>}
                        </div>
                        <p className={cn(
                          "text-sm text-muted-foreground",
                          !isExpanded && shouldTruncate && "line-clamp-2"
                        )} title={shouldTruncate && !isExpanded ? task.description : undefined}>
                          {task.description}
                        </p>
                        {shouldTruncate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleTaskExpansion(task.id)}
                            className="h-auto p-0 text-xs"
                          >
                            {isExpanded ? (
                              <>Show less <ChevronUp className="ml-1 h-3 w-3" /></>
                            ) : (
                              <>Show more <ChevronDown className="ml-1 h-3 w-3" /></>
                            )}
                          </Button>
                        )}
                      </div>
                      {!isSubmitted && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveTask(step.id, task.id)}
                          disabled={isSubmitting}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>

              {errors[step.id] && (
                <div className="text-sm text-destructive">{errors[step.id]}</div>
              )}
            </CardContent>

            {pendingTasks.length > 0 && (
              <CardFooter>
                <Button
                  onClick={() => handleSubmitStep(step)}
                  disabled={isSubmitting || pendingTasks.length === 0}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting {pendingTasks.length} tasks...
                    </>
                  ) : (
                    <>Submit {pendingTasks.length} tasks for Step {step.order}</>
                  )}
                </Button>
              </CardFooter>
            )}
          </Card>
        )
      })}
    </div>
  )
}