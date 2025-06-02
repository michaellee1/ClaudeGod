'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Initiative, InitiativePhase, InitiativeStatus as InitiativeStatusEnum } from '@/lib/types/initiative'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckCircle2, Circle, Clock, AlertCircle, RefreshCw, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'
import { InlineSuccessAnimation } from '@/components/SuccessAnimation'

interface PhaseInfo {
  phase: InitiativePhase
  label: string
  description: string
  estimatedTime: string
  status: 'completed' | 'active' | 'pending' | 'error'
  tooltip: string
}

interface InitiativeStatusProps {
  initiative: Initiative
  onRetry?: (phase: InitiativePhase) => void
  className?: string
}

function InitiativeStatusComponent({ initiative, onRetry, className }: InitiativeStatusProps) {
  const [expandedPhase, setExpandedPhase] = useState<InitiativePhase | null>(null)
  const [justCompletedPhases, setJustCompletedPhases] = useState<Set<InitiativePhase>>(new Set())
  const previousPhaseRef = useRef<InitiativePhase>(initiative.currentPhase)

  // Detect phase transitions and trigger success animations
  // This is an appropriate use of useEffect - we're synchronizing with prop changes
  // to trigger animations based on phase transitions
  useEffect(() => {
    const phaseOrder = [
      InitiativePhase.EXPLORATION,
      InitiativePhase.QUESTIONS,
      InitiativePhase.RESEARCH_PREP,
      InitiativePhase.RESEARCH_REVIEW,
      InitiativePhase.TASK_GENERATION,
      InitiativePhase.READY
    ]

    const currentIndex = phaseOrder.indexOf(initiative.currentPhase)
    const previousIndex = phaseOrder.indexOf(previousPhaseRef.current)

    // If we've moved forward in the phase order, the previous phase just completed
    if (currentIndex > previousIndex && previousIndex >= 0) {
      const completedPhase = previousPhaseRef.current
      setJustCompletedPhases(prev => new Set(prev).add(completedPhase))
      
      // Clear the animation after a delay
      setTimeout(() => {
        setJustCompletedPhases(prev => {
          const next = new Set(prev)
          next.delete(completedPhase)
          return next
        })
      }, 2000)
    }

    previousPhaseRef.current = initiative.currentPhase
  }, [initiative.currentPhase])

  const getPhaseStatus = (phase: InitiativePhase): 'completed' | 'active' | 'pending' | 'error' => {
    const phaseOrder = [
      InitiativePhase.EXPLORATION,
      InitiativePhase.QUESTIONS,
      InitiativePhase.RESEARCH_PREP,
      InitiativePhase.RESEARCH_REVIEW,
      InitiativePhase.TASK_GENERATION,
      InitiativePhase.READY
    ]

    const currentIndex = phaseOrder.indexOf(initiative.currentPhase)
    const phaseIndex = phaseOrder.indexOf(phase)

    if (initiative.lastError && phase === initiative.currentPhase) {
      return 'error'
    }

    if (phaseIndex < currentIndex) {
      return 'completed'
    } else if (phaseIndex === currentIndex) {
      return 'active'
    } else {
      return 'pending'
    }
  }

  const phases: PhaseInfo[] = [
    {
      phase: InitiativePhase.EXPLORATION,
      label: 'Exploration',
      description: 'Analyzing codebase and creating initial plan',
      estimatedTime: '2-3 minutes',
      status: getPhaseStatus(InitiativePhase.EXPLORATION),
      tooltip: 'Claude Code explores your codebase to understand the structure and create an initial implementation plan. This phase generates clarifying questions for better planning.'
    },
    {
      phase: InitiativePhase.QUESTIONS,
      label: 'Questions',
      description: 'Gathering requirements and clarifications',
      estimatedTime: '1-2 minutes',
      status: getPhaseStatus(InitiativePhase.QUESTIONS),
      tooltip: 'Answer the generated questions to provide context and constraints. Your answers help refine the implementation approach and ensure the solution meets your needs.'
    },
    {
      phase: InitiativePhase.RESEARCH_PREP,
      label: 'Research Preparation',
      description: 'Refining plan and identifying research needs',
      estimatedTime: '2-3 minutes',
      status: getPhaseStatus(InitiativePhase.RESEARCH_PREP),
      tooltip: 'Claude Code refines the plan based on your answers and identifies areas requiring research. This creates a focused research document for gathering additional information.'
    },
    {
      phase: InitiativePhase.RESEARCH_REVIEW,
      label: 'Research Review',
      description: 'Reviewing research results and insights',
      estimatedTime: '1-2 minutes',
      status: getPhaseStatus(InitiativePhase.RESEARCH_REVIEW),
      tooltip: 'Provide research findings from Deep Research or other sources. This information helps create more accurate and well-informed implementation tasks.'
    },
    {
      phase: InitiativePhase.TASK_GENERATION,
      label: 'Task Generation',
      description: 'Creating detailed task breakdown',
      estimatedTime: '3-5 minutes',
      status: getPhaseStatus(InitiativePhase.TASK_GENERATION),
      tooltip: 'Claude Code creates a detailed breakdown of tasks with specific implementation steps. Each task is self-contained with clear objectives and dependencies.'
    },
    {
      phase: InitiativePhase.READY,
      label: 'Ready',
      description: 'Tasks ready for submission',
      estimatedTime: 'Complete',
      status: getPhaseStatus(InitiativePhase.READY),
      tooltip: 'All tasks have been generated and are ready for submission to the task system. Review and submit tasks in the order that makes sense for your implementation.'
    }
  ]

  const getPhaseIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500 transition-all duration-500 scale-100" />
      case 'active':
        return (
          <div className="relative">
            <Circle className="w-5 h-5 text-blue-500 animate-pulse" />
            <div className="absolute inset-0 w-5 h-5 bg-blue-400 rounded-full animate-ping opacity-75" />
          </div>
        )
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500 animate-bounce" />
      default:
        return <Circle className="w-5 h-5 text-gray-300 transition-colors duration-300" />
    }
  }

  const getPhaseOutput = (phase: InitiativePhase) => {
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        return initiative.plan ? {
          title: 'Initial Plan',
          content: `Objective: ${initiative.plan.objective || 'Not specified'}\nScope: ${initiative.plan.scope || 'Not specified'}`
        } : null
      case InitiativePhase.QUESTIONS:
        return initiative.questions?.length ? {
          title: `${initiative.questions.length} Questions Generated`,
          content: initiative.questions.slice(0, 3).map(q => `• ${q?.question || 'Question unavailable'}`).join('\n')
        } : null
      case InitiativePhase.RESEARCH_PREP:
        return initiative.researchNeeds ? {
          title: 'Research Needs',
          content: initiative.researchNeeds.slice(0, 200) + '...'
        } : null
      case InitiativePhase.RESEARCH_REVIEW:
        return initiative.researchResults ? {
          title: 'Research Results',
          content: 'Research findings received'
        } : null
      case InitiativePhase.TASK_GENERATION:
        return initiative.taskSteps?.length ? {
          title: `${initiative.totalTasks || 0} Tasks Generated`,
          content: `${initiative.taskSteps.length} steps created`
        } : null
      case InitiativePhase.READY:
        return initiative.submittedTasks ? {
          title: 'Tasks Submitted',
          content: `${initiative.submittedTasks}/${initiative.totalTasks || 0} tasks submitted`
        } : null
      default:
        return null
    }
  }

  const togglePhaseExpansion = (phase: InitiativePhase) => {
    setExpandedPhase(expandedPhase === phase ? null : phase)
  }

  return (
    <TooltipProvider>
      <Card className={cn("p-4 sm:p-6", className)} role="region" aria-label="Initiative progress tracker">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Initiative Progress</h3>
          <Badge 
            variant={initiative.status === InitiativeStatusEnum.COMPLETED ? 'success' : 'default'}
            aria-label={`Initiative status: ${initiative.status}`}
          >
            {initiative.status}
          </Badge>
        </div>

        <div className="relative">
          {phases.map((phaseInfo, index) => {
            const isExpanded = expandedPhase === phaseInfo.phase
            const output = getPhaseOutput(phaseInfo.phase)
            
            return (
              <div key={phaseInfo.phase} className="relative">
                {index < phases.length - 1 && (
                  <div
                    className={cn(
                      "absolute left-[17px] top-[40px] w-0.5 h-full transition-colors duration-700",
                      phaseInfo.status === 'completed' ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  />
                )}
                
                <div className="relative flex items-start space-x-3 sm:space-x-4 pb-6 sm:pb-8">
                  <div className="relative z-10 bg-background" aria-hidden="true">
                    {getPhaseIcon(phaseInfo.status)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "rounded-lg border p-3 sm:p-4 transition-all duration-300 transform",
                        phaseInfo.status === 'active' && "border-blue-500 bg-blue-50 dark:bg-blue-950/20 shadow-lg sm:scale-[1.02]",
                        phaseInfo.status === 'error' && "border-red-500 bg-red-50 dark:bg-red-950/20 shadow-red-200",
                        phaseInfo.status === 'completed' && "bg-gray-50 dark:bg-gray-900/50 opacity-90",
                        "cursor-pointer hover:shadow-lg sm:hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      )}
                      onClick={() => togglePhaseExpansion(phaseInfo.phase)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          togglePhaseExpansion(phaseInfo.phase)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-label={`${phaseInfo.label} phase - ${phaseInfo.status}. ${phaseInfo.description}. Click to ${isExpanded ? 'collapse' : 'expand'} details.`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium text-sm sm:text-base">{phaseInfo.label}</h4>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>{phaseInfo.tooltip}</p>
                              </TooltipContent>
                            </Tooltip>
                            <InlineSuccessAnimation
                              show={justCompletedPhases.has(phaseInfo.phase)}
                              message="Phase complete!"
                            />
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 mt-1">{phaseInfo.description}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Clock className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-500">{phaseInfo.estimatedTime}</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {phaseInfo.status === 'error' && onRetry && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRetry(phaseInfo.phase)
                              }}
                              aria-label={`Retry ${phaseInfo.label} phase`}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" />
                              Retry
                            </Button>
                          )}
                          {output && (
                            <div className={cn("transition-transform duration-200", isExpanded && "rotate-180")}>
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {phaseInfo.status === 'error' && initiative.lastError && (
                        <div className="mt-3 p-2 bg-red-100 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-400">
                          {initiative.lastError}
                        </div>
                      )}
                      
                      {output && (
                        <div className={cn(
                          "overflow-hidden transition-all duration-300",
                          isExpanded ? "max-h-96 opacity-100 mt-4" : "max-h-0 opacity-0"
                        )}>
                          <div className="pt-4 border-t">
                            <h5 className="text-sm font-medium mb-2">{output.title}</h5>
                            <pre className="text-xs text-gray-600 whitespace-pre-wrap">{output.content}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {initiative.totalTasks && initiative.submittedTasks !== undefined && (
          <div className="mt-4 pt-4 border-t" role="region" aria-label="Overall progress">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Overall Progress</span>
              <span className="font-medium" aria-live="polite" aria-atomic="true">
                {initiative.submittedTasks} / {initiative.totalTasks} tasks submitted
              </span>
            </div>
            <div 
              className="mt-2 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={initiative.totalTasks}
              aria-valuenow={initiative.submittedTasks}
              aria-label={`Overall progress: ${initiative.submittedTasks} of ${initiative.totalTasks} tasks submitted`}
            >
              <div
                className="bg-gradient-to-r from-blue-400 to-blue-600 h-2 rounded-full transition-all duration-500 ease-out relative"
                style={{ width: `${initiative.totalTasks > 0 ? (initiative.submittedTasks / initiative.totalTasks) * 100 : 0}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
    </TooltipProvider>
  )
}

export const InitiativeStatus = React.memo(InitiativeStatusComponent)