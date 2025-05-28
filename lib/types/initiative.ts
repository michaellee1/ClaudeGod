import { Task } from './task'

export enum InitiativeStatus {
  EXPLORING = 'exploring',
  AWAITING_ANSWERS = 'awaiting_answers',
  RESEARCHING = 'researching',
  AWAITING_RESEARCH = 'awaiting_research',
  PLANNING = 'planning',
  READY_FOR_TASKS = 'ready_for_tasks',
  TASKS_SUBMITTED = 'tasks_submitted',
  COMPLETED = 'completed'
}

export enum InitiativePhase {
  EXPLORATION = 'exploration',
  QUESTIONS = 'questions',
  RESEARCH_PREP = 'research_prep',
  RESEARCH_REVIEW = 'research_review',
  TASK_GENERATION = 'task_generation',
  READY = 'ready'
}

export interface InitiativeQuestion {
  id: string
  question: string
  category?: string
  priority?: 'high' | 'medium' | 'low'
  createdAt: Date
}

export interface InitiativeResearch {
  id: string
  topic: string
  description: string
  findings?: string
  createdAt: Date
  updatedAt?: Date
}

export interface InitiativePlan {
  objective: string
  scope: string
  approach: string
  constraints?: string[]
  assumptions?: string[]
  createdAt: Date
  updatedAt?: Date
}

export interface InitiativeTask {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  dependencies?: string[]
  estimatedEffort?: string
  status: 'pending' | 'ready' | 'submitted'
  taskId?: string // Reference to created task in task system
  taskData?: Partial<Task> // Contains task data when submitted to task system
  createdAt: Date
}

export interface InitiativeTaskStep {
  id: string
  name: string
  description: string
  order: number
  tasks: InitiativeTask[]
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: Date
  updatedAt?: Date
}

export interface Initiative {
  id: string
  objective: string
  status: InitiativeStatus
  currentPhase: InitiativePhase
  createdAt: Date
  updatedAt: Date
  
  // Phase-specific data
  questions?: InitiativeQuestion[]
  userAnswers?: Record<string, string>
  researchNeeds?: string
  researchResults?: string
  plan?: InitiativePlan
  taskSteps?: InitiativeTaskStep[]
  
  // Process management
  processId?: string
  lastError?: string
  
  // Metadata
  totalTasks?: number
  submittedTasks?: number
  
  // YOLO mode
  yoloMode?: boolean
  currentStepIndex?: number
}

export interface InitiativeOutput {
  timestamp: Date
  type: 'info' | 'error' | 'phase_complete' | 'question' | 'task'
  content: string
  phase?: InitiativePhase
  metadata?: Record<string, any>
}

export interface InitiativeProcessMessage {
  type: 'output' | 'phase_complete' | 'questions_generated' | 'tasks_generated' | 'error'
  initiativeId: string
  data: any
}