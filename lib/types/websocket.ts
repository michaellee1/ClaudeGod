import { Task, TaskOutput } from './task'

export interface WebSocketMessage {
  type: 'connected' | 'task-update' | 'task-output' | 'task-removed' | 'subscribe' | 'unsubscribe'
  taskId?: string
  data?: Task | TaskOutput | any
}

export interface SubscribeMessage {
  type: 'subscribe'
  taskId: string
}

export interface UnsubscribeMessage {
  type: 'unsubscribe'
  taskId: string
}

export interface TaskUpdateMessage {
  type: 'task-update'
  taskId: string
  data: Task
}

export interface TaskOutputMessage {
  type: 'task-output'
  taskId: string
  data: TaskOutput
}

export interface TaskRemovedMessage {
  type: 'task-removed'
  taskId: string
}