'use client'

import { useState, useEffect } from 'react'
import { Task } from '@/lib/types/task'
import Link from 'next/link'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronDown, Trash2 } from 'lucide-react'

interface TaskTableProps {
  tasks: Task[]
  onPreview: (taskId: string, isCurrentlyPreviewing: boolean) => void
  onMerge: (taskId: string) => void
  onDelete: (taskId: string) => void
  previewingTaskId: string | null
}

function TaskTable({ tasks, onPreview, onMerge, onDelete, previewingTaskId }: TaskTableProps) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-center py-4">No tasks in this category</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Prompt</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="font-mono text-sm">
              {task.id.substring(0, 8)}
            </TableCell>
            <TableCell className="max-w-xs truncate">
              {task.prompt}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  task.status === 'starting' ? 'outline' :
                  task.status === 'in_progress' ? 'default' :
                  task.status === 'finished' ? 'success' :
                  task.status === 'merged' ? 'purple' :
                  'destructive'
                }
              >
                {task.status}
              </Badge>
            </TableCell>
            <TableCell>
              <span className="text-sm text-muted-foreground">
                {task.phase}
              </span>
            </TableCell>
            <TableCell>
              {new Date(task.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button variant="link" asChild>
                  <Link href={`/task/${task.id}`}>
                    View Details
                  </Link>
                </Button>
                <Button
                  onClick={() => onPreview(task.id, previewingTaskId === task.id)}
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${previewingTaskId === task.id ? 'text-orange-500 hover:text-orange-600' : 'hover:text-primary'}`}
                  title={previewingTaskId === task.id ? 'Stop Preview' : 'Preview Changes'}
                >
                  {previewingTaskId === task.id ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </Button>
                <Button
                  onClick={() => onMerge(task.id)}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-600 hover:text-green-700"
                  title="Merge Task"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="18" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M6 21V9a9 9 0 0 0 9 9" />
                  </svg>
                </Button>
                <Button
                  onClick={() => onDelete(task.id)}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Delete Task"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeletingAll, setIsDeletingAll] = useState(false)
  const [previewingTaskId, setPreviewingTaskId] = useState<string | null>(null)
  const [thinkMode, setThinkMode] = useState('none')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  
  // Use WebSocket for real-time updates
  const { lastMessage } = useWebSocket('/ws')

  useEffect(() => {
    fetchTasks()
    fetchRepoPath()
  }, [])

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'task-update' || 
        lastMessage.type === 'task-output' ||
        lastMessage.type === 'task-removed') {
      // Refresh tasks when any update is received
      fetchTasks()
    }
  }, [lastMessage])

  const fetchRepoPath = async () => {
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const data = await response.json()
        if (data.repoPath) {
          setRepoPath(data.repoPath)
        }
      }
    } catch (error) {
      console.error('Error fetching repo path:', error)
    }
  }

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/tasks')
      if (response.ok) {
        const data = await response.json()
        setTasks(data)
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to remove this task? This will delete the worktree and all changes.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to remove task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error removing task:', error)
      setError(`Failed to remove task: ${error.message || 'Network error'}`)
    }
  }

  const handleDeleteNonInProgressTasks = async () => {
    const nonInProgressTasks = tasks.filter(task => task.status !== 'in_progress')
    
    if (nonInProgressTasks.length === 0) {
      setError('No non-in-progress tasks to delete')
      return
    }
    
    if (!confirm(`Are you sure you want to delete ${nonInProgressTasks.length} non-in-progress task(s)? This will remove their worktrees and changes permanently.`)) {
      return
    }
    
    setIsDeletingAll(true)
    setError(null)
    
    try {
      // Delete each non-in-progress task
      const deletePromises = nonInProgressTasks.map(task => 
        fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      )
      
      const results = await Promise.all(deletePromises)
      const failedDeletes = results.filter(r => !r.ok)
      
      if (failedDeletes.length > 0) {
        setError(`Failed to delete ${failedDeletes.length} task(s)`)
      } else {
        fetchTasks()
      }
    } catch (error: any) {
      console.error('Error deleting non-in-progress tasks:', error)
      setError(`Failed to delete tasks: ${error.message || 'Network error'}`)
    } finally {
      setIsDeletingAll(false)
    }
  }

  const handlePreview = async (taskId: string, isCurrentlyPreviewing: boolean) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/preview`, {
        method: isCurrentlyPreviewing ? 'DELETE' : 'POST',
      })
      
      if (response.ok) {
        setPreviewingTaskId(isCurrentlyPreviewing ? null : taskId)
        setError(null)
      } else {
        const errorData = await response.json()
        setError(`Failed to ${isCurrentlyPreviewing ? 'stop' : 'start'} preview: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error toggling preview:', error)
      setError(`Failed to ${isCurrentlyPreviewing ? 'stop' : 'start'} preview: ${error.message || 'Network error'}`)
    }
  }

  const handleMerge = async (taskId: string) => {
    if (!confirm('Are you sure you want to merge this task? This will merge the changes into the main branch.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/tasks/${taskId}/merge`, {
        method: 'POST',
      })
      
      if (response.ok) {
        alert('Task merged successfully!')
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to merge task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error merging task:', error)
      setError(`Failed to merge task: ${error.message || 'Network error'}`)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        setError('Image size must be less than 10MB')
        e.target.value = '' // Reset input
        return
      }
      
      setSelectedImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleClearImage = () => {
    setSelectedImage(null)
    setImagePreview(null)
    const fileInput = document.getElementById('image') as HTMLInputElement
    if (fileInput) {
      fileInput.value = ''
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || !repoPath.trim()) return

    let finalPrompt = prompt
    
    // Add think mode first (it will be moved after image ref on backend)
    if (thinkMode !== 'none' && thinkMode !== 'no_review') {
      const thinkModeText = thinkMode === 'level1' ? 'Think hard' : 
                           thinkMode === 'level2' ? 'Ultrathink' : 
                           ''
      if (thinkModeText) {
        finalPrompt = `${finalPrompt}. ${thinkModeText}`
      }
    }

    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('prompt', finalPrompt)
      formData.append('repoPath', repoPath)
      formData.append('thinkMode', thinkMode)
      if (selectedImage) {
        formData.append('image', selectedImage)
      }

      const response = await fetch('/api/tasks', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        setPrompt('')
        setSelectedImage(null)
        setImagePreview(null)
        setError(null)
        fetchTasks()
      } else {
        const errorData = await response.json()
        setError(`Failed to create task: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('Error submitting task:', error)
      setError(`Failed to submit task: ${error.message || 'Network error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="w-full px-8 py-8">
      
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Submit New Task</CardTitle>
            <CardDescription>Create a new coding task for Claude to work on</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="repoPath">Repository Path</Label>
                <Input
                  id="repoPath"
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/path/to/your/repo"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="prompt">Task Description</Label>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px]"
                  placeholder="Describe your task..."
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="image">Attach Image (Optional)</Label>
                <div className="flex flex-col gap-2">
                  <Input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="cursor-pointer"
                  />
                  {imagePreview && (
                    <div className="mt-2 relative inline-block">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="max-w-xs max-h-40 rounded border border-gray-200"
                      />
                      <Button
                        type="button"
                        onClick={handleClearImage}
                        className="absolute top-1 right-1 p-1 h-6 w-6"
                        variant="destructive"
                        size="sm"
                      >
                        ×
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Think Mode</Label>
                <RadioGroup value={thinkMode} onValueChange={setThinkMode}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="none" id="none" />
                    <Label htmlFor="none" className="font-normal">None</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="no_review" id="no_review" />
                    <Label htmlFor="no_review" className="font-normal">No Review</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="level1" id="level1" />
                    <Label htmlFor="level1" className="font-normal">Think hard (level 1)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="level2" id="level2" />
                    <Label htmlFor="level2" className="font-normal">Ultrathink (level 2)</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Task'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Active Tasks</CardTitle>
                <CardDescription>View and manage your ongoing coding tasks</CardDescription>
              </div>
              {tasks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Actions
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleDeleteNonInProgressTasks}
                      disabled={isDeletingAll}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {isDeletingAll ? 'Deleting Tasks...' : 'Delete Non In-Progress'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-muted-foreground">No active tasks</p>
            ) : (
              <Tabs defaultValue="active" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="active">
                    Active ({tasks.filter(t => t.status === 'in_progress' || t.status === 'finished').length})
                  </TabsTrigger>
                  <TabsTrigger value="other">
                    Other ({tasks.filter(t => t.status !== 'in_progress' && t.status !== 'finished').length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="active">
                  <TaskTable 
                    tasks={tasks.filter(t => t.status === 'in_progress' || t.status === 'finished')}
                    onPreview={handlePreview}
                    onMerge={handleMerge}
                    onDelete={handleDeleteTask}
                    previewingTaskId={previewingTaskId}
                  />
                </TabsContent>
                <TabsContent value="other">
                  <TaskTable 
                    tasks={tasks.filter(t => t.status !== 'in_progress' && t.status !== 'finished')}
                    onPreview={handlePreview}
                    onMerge={handleMerge}
                    onDelete={handleDeleteTask}
                    previewingTaskId={previewingTaskId}
                  />
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}