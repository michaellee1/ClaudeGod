export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed' | 'merged'
  phase: 'editor' | 'reviewer' | 'done'
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
  thinkMode?: string
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