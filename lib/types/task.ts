export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed' | 'interrupted'
  phase: 'editor' | 'reviewer' | 'done' | 'interrupted'
  worktree: string
  createdAt: Date
  editorPid?: number
  reviewerPid?: number
  output: TaskOutput[]
  isSelfModification?: boolean
  commitHash?: string
  isPreviewing?: boolean
}

export interface TaskOutput {
  id: string
  taskId: string
  type: 'editor' | 'reviewer'
  content: string
  timestamp: Date
}