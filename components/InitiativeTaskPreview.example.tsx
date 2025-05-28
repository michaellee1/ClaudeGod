// Example usage of InitiativeTaskPreview component
import { InitiativeTaskPreview } from './InitiativeTaskPreview'
import { InitiativeTask, InitiativeTaskStep } from '@/lib/types/initiative'

// Example data
const exampleSteps: InitiativeTaskStep[] = [
  {
    id: 'step-1',
    name: 'Setup Database Schema',
    description: 'Create the necessary database tables and relationships',
    order: 1,
    tasks: [
      {
        id: 'task-1-1',
        title: 'Create users table',
        description: 'Design and implement the users table with all necessary fields including id, email, password hash, created_at, updated_at. Add proper indexes for performance.',
        priority: 'high',
        status: 'pending',
        createdAt: new Date()
      },
      {
        id: 'task-1-2',
        title: 'Create products table',
        description: 'Implement products table with fields for name, description, price, inventory count',
        priority: 'high',
        status: 'pending',
        createdAt: new Date()
      }
    ],
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'step-2',
    name: 'Build API Endpoints',
    description: 'Implement RESTful API endpoints for the application',
    order: 2,
    tasks: [
      {
        id: 'task-2-1',
        title: 'User authentication endpoints',
        description: 'Create login, logout, and registration endpoints',
        priority: 'high',
        status: 'pending',
        createdAt: new Date()
      },
      {
        id: 'task-2-2',
        title: 'Product CRUD endpoints',
        description: 'Implement Create, Read, Update, Delete operations for products',
        priority: 'medium',
        status: 'pending',
        createdAt: new Date()
      }
    ],
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
  }
]

const globalContext = `Building an e-commerce platform with user authentication and product management.
The system should be scalable and follow best practices for security and performance.`

export function InitiativeTaskPreviewExample() {
  const handleSubmitStep = async (stepId: string, tasks: InitiativeTask[], thinkMode: string) => {
    console.log('Submitting step:', stepId, 'with', tasks.length, 'tasks in', thinkMode, 'mode')
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const handleRemoveTask = (stepId: string, taskId: string) => {
    console.log('Removing task:', taskId, 'from step:', stepId)
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Initiative Task Preview Example</h1>
      <InitiativeTaskPreview
        steps={exampleSteps}
        globalContext={globalContext}
        onSubmitStep={handleSubmitStep}
        onRemoveTask={handleRemoveTask}
      />
    </div>
  )
}