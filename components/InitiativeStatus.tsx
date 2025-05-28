'use client'

import React, { useState } from 'react'
import { Initiative, InitiativePhase, InitiativeStatus as InitiativeStatusEnum } from '@/lib/types/initiative'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CheckCircle2, Circle, Clock, AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

interface PhaseInfo {
  phase: InitiativePhase
  label: string
  description: string
  estimatedTime: string
  status: 'completed' | 'active' | 'pending' | 'error'
}

interface InitiativeStatusProps {
  initiative: Initiative
  onRetry?: (phase: InitiativePhase) => void
  className?: string
}

export function InitiativeStatus({ initiative, onRetry, className }: InitiativeStatusProps) {
  const [expandedPhase, setExpandedPhase] = useState<InitiativePhase | null>(null)

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
      status: getPhaseStatus(InitiativePhase.EXPLORATION)
    },
    {
      phase: InitiativePhase.QUESTIONS,
      label: 'Questions',
      description: 'Gathering requirements and clarifications',
      estimatedTime: '1-2 minutes',
      status: getPhaseStatus(InitiativePhase.QUESTIONS)
    },
    {
      phase: InitiativePhase.RESEARCH_PREP,
      label: 'Research Preparation',
      description: 'Refining plan and identifying research needs',
      estimatedTime: '2-3 minutes',
      status: getPhaseStatus(InitiativePhase.RESEARCH_PREP)
    },
    {
      phase: InitiativePhase.RESEARCH_REVIEW,
      label: 'Research Review',
      description: 'Reviewing research results and insights',
      estimatedTime: '1-2 minutes',
      status: getPhaseStatus(InitiativePhase.RESEARCH_REVIEW)
    },
    {
      phase: InitiativePhase.TASK_GENERATION,
      label: 'Task Generation',
      description: 'Creating detailed task breakdown',
      estimatedTime: '3-5 minutes',
      status: getPhaseStatus(InitiativePhase.TASK_GENERATION)
    },
    {
      phase: InitiativePhase.READY,
      label: 'Ready',
      description: 'Tasks ready for submission',
      estimatedTime: 'Complete',
      status: getPhaseStatus(InitiativePhase.READY)
    }
  ]

  const getPhaseIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'active':
        return <Circle className="w-5 h-5 text-blue-500 animate-pulse" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Circle className="w-5 h-5 text-gray-300" />
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
    <Card className={cn("p-6", className)}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Initiative Progress</h3>
          <Badge variant={initiative.status === InitiativeStatusEnum.COMPLETED ? 'success' : 'default'}>
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
                      "absolute left-[17px] top-[40px] w-0.5 h-full",
                      phaseInfo.status === 'completed' ? "bg-green-500" : "bg-gray-200"
                    )}
                  />
                )}
                
                <div className="relative flex items-start space-x-4 pb-8">
                  <div className="relative z-10 bg-white">
                    {getPhaseIcon(phaseInfo.status)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "rounded-lg border p-4 transition-all duration-200",
                        phaseInfo.status === 'active' && "border-blue-500 bg-blue-50",
                        phaseInfo.status === 'error' && "border-red-500 bg-red-50",
                        phaseInfo.status === 'completed' && "bg-gray-50",
                        "cursor-pointer hover:shadow-md"
                      )}
                      onClick={() => togglePhaseExpansion(phaseInfo.phase)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium">{phaseInfo.label}</h4>
                          <p className="text-sm text-gray-600 mt-1">{phaseInfo.description}</p>
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
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          )}
                          {output && (
                            isExpanded ? 
                              <ChevronUp className="w-4 h-4 text-gray-400" /> : 
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </div>
                      
                      {phaseInfo.status === 'error' && initiative.lastError && (
                        <div className="mt-3 p-2 bg-red-100 rounded text-xs text-red-700">
                          {initiative.lastError}
                        </div>
                      )}
                      
                      {isExpanded && output && (
                        <div className="mt-4 pt-4 border-t">
                          <h5 className="text-sm font-medium mb-2">{output.title}</h5>
                          <pre className="text-xs text-gray-600 whitespace-pre-wrap">{output.content}</pre>
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
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Overall Progress</span>
              <span className="font-medium">{initiative.submittedTasks} / {initiative.totalTasks} tasks submitted</span>
            </div>
            <div className="mt-2 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${initiative.totalTasks > 0 ? (initiative.submittedTasks / initiative.totalTasks) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}