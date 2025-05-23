export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed' | 'interrupted' | 'merged'
  phase: 'editor' | 'reviewer' | 'done' | 'interrupted'
  worktree: string
  repoPath: string
  createdAt: Date
  mergedAt?: Date
  editorPid?: number
  reviewerPid?: number
  output: TaskOutput[]
  isSelfModification?: boolean
  commitHash?: string
  isPreviewing?: boolean
  promptHistory?: PromptCycle[]
  mergedAt?: Date
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
  type: 'editor' | 'reviewer'
  content: string
  timestamp: Date
}