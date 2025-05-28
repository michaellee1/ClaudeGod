export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed' | 'merged'
  phase: 'planner' | 'editor' | 'reviewer' | 'done'
  worktree: string
  repoPath: string
  createdAt: Date
  mergedAt?: Date
  editorPid?: number
  reviewerPid?: number
  plannerPid?: number
  output: TaskOutput[]
  isSelfModification?: boolean
  commitHash?: string
  isPreviewing?: boolean
  promptHistory?: PromptCycle[]
  thinkMode?: string
  initiativeId?: string
  stepNumber?: number
  globalContext?: string
}

export interface PromptCycle {
  prompt: string
  timestamp: Date
  commitHash?: string
  mergedAt?: Date
}

export interface TaskOutput {
  id: string
  taskId: string
  type: 'planner' | 'editor' | 'reviewer'
  content: string
  timestamp: Date
}