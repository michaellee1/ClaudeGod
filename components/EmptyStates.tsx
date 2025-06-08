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

