'use client'

import { useState, useEffect } from 'react'
import { Task } from '@/lib/types/task'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronDown, Trash2, Plus, Terminal, ExternalLink } from 'lucide-react'


interface TaskTableProps {
  tasks: Task[]
  onBringToFront: (taskId: string) => void
  onDelete: (taskId: string) => void
}

function TaskTable({ tasks, onBringToFront, onDelete }: TaskTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="max-w-md">
              <div className="whitespace-pre-wrap break-words">{task.prompt}</div>
              <div className="text-xs text-muted-foreground">{task.id}</div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">
                {task.mode || 'edit'}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(task.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Button
                  onClick={() => onBringToFront(task.id)}
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  title="Bring Terminal to Front"
                >
                  <Terminal className="h-3.5 w-3.5 mr-1" />
                  Terminal
                </Button>
                <Button variant="link" asChild size="sm" className="h-8 px-2">
                  <Link href={`/task/${task.id}`}>View</Link>
                </Button>
                <Button
                  onClick={() => onDelete(task.id)}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Delete Task"
                >
                  <Trash2 className="h-3 w-3" />
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
  const [mode, setMode] = useState('edit')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  
  useEffect(() => {
    const initializeData = async () => {
      try {
        await Promise.all([fetchTasks(), fetchRepoPath()])
      } finally {
        setIsInitializing(false)
      }
    }
    initializeData()
    
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchTasks, 5000)
    return () => clearInterval(interval)
  }, [])

  // Add keyboard shortcut for Command+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  const handleBringToFront = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/focus`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to bring terminal to front')
      }
    } catch (error: any) {
      console.error('Error bringing terminal to front:', error)
      setError(error.message || 'Failed to bring terminal to front')
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        // Immediately update the UI
        fetchTasks()
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to delete task')
      }
    } catch (error) {
      console.error('Error deleting task:', error)
      setError('Failed to delete task')
    }
  }

  const handleDeleteAllTasks = async () => {
    if (tasks.length === 0) {
      setError('No tasks to delete')
      return
    }
    
    if (!confirm(`Delete all ${tasks.length} tasks?`)) {
      return
    }
    
    setIsDeletingAll(true)
    try {
      await Promise.all(
        tasks.map(task =>
          fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
        )
      )
      fetchTasks()
    } catch (error) {
      console.error('Error deleting tasks:', error)
    } finally {
      setIsDeletingAll(false)
    }
  }

  const handleKillAllProcesses = async () => {
    if (!confirm('Clear all terminal references? This will remove tracking of iTerm sessions but won\'t close them.')) {
      return
    }
    
    try {
      const response = await fetch('/api/processes/cleanup', {
        method: 'POST',
      })
      
      if (response.ok) {
        alert('All terminal references have been cleared')
        fetchTasks()
      }
    } catch (error) {
      console.error('Error clearing terminal references:', error)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('Image size must be less than 10MB')
        e.target.value = ''
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

    // Basic path validation
    const trimmedPath = repoPath.trim()
    if (!trimmedPath.startsWith('/') && !trimmedPath.startsWith('~')) {
      setError('Repository path must be an absolute path (starting with / or ~)')
      return
    }

    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('prompt', prompt.trim())
      formData.append('repoPath', repoPath.trim())
      formData.append('mode', mode)
      if (selectedImage) {
        formData.append('image', selectedImage)
      }

      const response = await fetch('/api/tasks', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const task = await response.json()
        setPrompt('')
        setSelectedImage(null)
        setImagePreview(null)
        setError(null)
        setIsModalOpen(false)
        
        // Start the task immediately
        await fetch(`/api/tasks/${task.id}/start`, {
          method: 'POST'
        })
        
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

  // Sort tasks by creation date, newest first
  const sortedTasks = [...tasks].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <div className="w-full px-4 py-6">
      {/* Header with Submit button */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Task Management</h1>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsModalOpen(true)}
            size="sm"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Submit New Task
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
          
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
                  onClick={handleDeleteAllTasks}
                  disabled={isDeletingAll}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isDeletingAll ? 'Deleting Tasks...' : 'Delete All Tasks'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleKillAllProcesses}
                  className="text-destructive focus:text-destructive"
                >
                  <Terminal className="mr-2 h-4 w-4" />
                  Clear All Terminal References
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* All Tasks Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Tasks ({tasks.length})
        </h2>
        {sortedTasks.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No tasks yet. Click "Submit New Task" to get started.</p>
          </Card>
        ) : (
          <TaskTable
            tasks={sortedTasks}
            onBringToFront={handleBringToFront}
            onDelete={handleDeleteTask}
          />
        )}
      </div>

      {/* Task Submission Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Submit New Task</DialogTitle>
            <DialogDescription>
              Create a coding task with clear requirements
            </DialogDescription>
          </DialogHeader>
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
              <p className="text-sm text-muted-foreground">
                Enter the absolute path to your git repository (e.g., /Users/username/projects/myrepo)
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="prompt">Task Description</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[120px]"
                placeholder="Describe what needs to be built or fixed..."
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
              <Label>Mode</Label>
              <RadioGroup value={mode} onValueChange={setMode}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="edit" id="edit" />
                  <Label htmlFor="edit" className="font-normal">Edit Mode (Direct implementation)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="planning" id="planning" />
                  <Label htmlFor="planning" className="font-normal">Planning Mode (Create plan first)</Label>
                </div>
              </RadioGroup>
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Task'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}