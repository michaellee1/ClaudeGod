export interface Task {
  id: string
  prompt: string
  status: 'starting' | 'in_progress' | 'finished' | 'failed'
  phase: 'editor' | 'reviewer' | 'done'
  worktree: string
  createdAt: Date
  editorPid?: number
  reviewerPid?: number
  output: TaskOutput[]
}

export interface TaskOutput {
  id: string
  taskId: string
  type: 'editor' | 'reviewer'
  content: string
  timestamp: Date
}