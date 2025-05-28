'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FileText, FolderOpen, CheckCircle2, FileQuestion, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Card className={cn("p-12 text-center", className)}>
      {icon && (
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-full">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">{description}</p>
      {action && (
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  )
}

export function InitiativesEmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <EmptyState
      icon={<FolderOpen className="w-8 h-8 text-gray-400" />}
      title="No initiatives yet"
      description="Create your first initiative to start breaking down complex objectives into manageable tasks."
      action={{
        label: "Create Initiative",
        onClick: onCreateClick
      }}
    />
  )
}

export function QuestionsEmptyState() {
  return (
    <EmptyState
      icon={<FileQuestion className="w-8 h-8 text-gray-400" />}
      title="No questions available"
      description="Questions will appear here once the exploration phase is complete."
    />
  )
}

export function TasksEmptyState() {
  return (
    <EmptyState
      icon={<FileText className="w-8 h-8 text-gray-400" />}
      title="No tasks generated yet"
      description="Tasks will be generated after completing all prerequisite phases."
    />
  )
}

export function ResearchEmptyState() {
  return (
    <EmptyState
      icon={<FileText className="w-8 h-8 text-gray-400" />}
      title="No research needs identified"
      description="Research needs will be identified during the research preparation phase."
    />
  )
}

export function OutputEmptyState() {
  return (
    <div className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-8 rounded-lg font-mono text-xs">
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className="p-3 bg-gray-800 dark:bg-gray-900 rounded-full">
          <FileText className="w-6 h-6 text-gray-500 dark:text-gray-600" />
        </div>
        <p className="text-gray-500 dark:text-gray-600">No output yet...</p>
        <p className="text-gray-600 dark:text-gray-700 text-center max-w-sm">
          Process output will appear here as the initiative progresses through its phases.
        </p>
      </div>
    </div>
  )
}