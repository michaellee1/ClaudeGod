'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
// API response type for initiatives
interface InitiativeResponse {
  id: string
  objective: string
  phase: string
  status: string
  createdAt: string
  updatedAt: string
  isActive: boolean
  yoloMode?: boolean
  currentStepIndex?: number
}
import { useInitiativeWebSocket } from '@/lib/hooks/useInitiativeWebSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Eye, Trash2, CheckCircle2, Plus, Loader2, HelpCircle, Search, Filter } from 'lucide-react'
import { InitiativeHelpModal } from '@/components/InitiativeHelpModal'
import { InitiativeListSkeleton } from '@/components/InitiativeSkeletons'
import { InitiativesEmptyState } from '@/components/EmptyStates'
import { useDebounce } from '@/lib/hooks/useDebounce'

// Map InitiativeStore's phase to our status for display
const getStatusFromPhase = (phase: string): string => {
  const phaseStatusMap: Record<string, string> = {
    'exploration': 'exploring',
    'questions': 'awaiting_answers',
    'research_prep': 'researching',
    'research_review': 'awaiting_research',
    'task_generation': 'planning',
    'ready': 'ready_for_tasks'
  }
  return phaseStatusMap[phase] || phase
}

// Get badge variant for status
const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" | "success" | "purple" => {
  const statusVariantMap: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "purple"> = {
    'exploring': 'default',
    'awaiting_answers': 'secondary',
    'researching': 'default',
    'awaiting_research': 'secondary',
    'planning': 'default',
    'ready_for_tasks': 'success',
    'tasks_submitted': 'purple',
    'completed': 'success'
  }
  return statusVariantMap[status] || 'outline'
}

// Format phase for display
const formatPhase = (phase: string): string => {
  const phaseDisplayMap: Record<string, string> = {
    'exploration': 'Exploration',
    'questions': 'Questions',
    'research_prep': 'Research Prep',
    'research_review': 'Research Review',
    'task_generation': 'Task Generation',
    'ready': 'Ready'
  }
  return phaseDisplayMap[phase] || phase
}

export default function InitiativesPage() {
  const [initiatives, setInitiatives] = useState<InitiativeResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newObjective, setNewObjective] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deleteInitiativeId, setDeleteInitiativeId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const lastUpdateRef = useRef<{ [key: string]: number }>({})

  // WebSocket for real-time updates
  const { lastMessage } = useInitiativeWebSocket('/ws', {
    onInitiativeUpdate: (initiative) => {
      // Debounce duplicate updates within 300ms
      const now = Date.now()
      const lastUpdate = lastUpdateRef.current[initiative.id] || 0
      if (now - lastUpdate < 300) {
        return // Skip duplicate update
      }
      lastUpdateRef.current[initiative.id] = now
      
      setInitiatives(prev => {
        // Check if initiative already exists
        const existingIndex = prev.findIndex(i => i.id === initiative.id)
        
        // Map Initiative to InitiativeResponse
        const response: InitiativeResponse = {
          id: initiative.id,
          objective: initiative.objective,
          phase: initiative.currentPhase,
          status: initiative.status,
          createdAt: typeof initiative.createdAt === 'string' ? initiative.createdAt : 
                    initiative.createdAt ? new Date(initiative.createdAt).toISOString() : new Date().toISOString(),
          updatedAt: typeof initiative.updatedAt === 'string' ? initiative.updatedAt :
                    initiative.updatedAt ? new Date(initiative.updatedAt).toISOString() : new Date().toISOString(),
          isActive: initiative.status !== 'completed' && initiative.status !== 'tasks_submitted',
          yoloMode: initiative.yoloMode,
          currentStepIndex: initiative.currentStepIndex
        }
        
        if (existingIndex >= 0) {
          // Update existing initiative only if it's actually newer
          const existing = prev[existingIndex]
          if (new Date(response.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
            const updated = [...prev]
            updated[existingIndex] = response
            return updated
          }
          return prev // Skip update if not newer
        } else {
          // Check for duplicate by creation time (within 5 seconds)
          const createdAt = new Date(response.createdAt).getTime()
          const isDuplicate = prev.some(i => {
            const iCreatedAt = new Date(i.createdAt).getTime()
            return Math.abs(createdAt - iCreatedAt) < 5000 && i.objective === response.objective
          })
          
          if (isDuplicate) {
            return prev // Skip duplicate
          }
          
          // Add new initiative at the beginning
          return [response, ...prev]
        }
      })
    },
    onInitiativeRemoved: (initiativeId) => {
      setInitiatives(prev => prev.filter(i => i.id !== initiativeId))
    }
  })

  // Fetching initiatives on mount is an appropriate use of useEffect
  // We're synchronizing with external data from the server
  useEffect(() => {
    fetchInitiatives()
  }, [])

  const fetchInitiatives = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/initiatives')
      if (!response.ok) {
        throw new Error('Failed to fetch initiatives')
      }
      const data = await response.json()
      setInitiatives(data)
      setError(null)
    } catch (err) {
      console.error('Error fetching initiatives:', err)
      setError('Failed to load initiatives')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateInitiative = async () => {
    if (!newObjective.trim() || isCreating) return

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/initiatives', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ objective: newObjective }),
      })

      if (!response.ok) {
        const data = await response.json()
        const errorMessage = data.error?.message || data.error || 'Failed to create initiative'
        throw new Error(errorMessage)
      }

      await response.json()
      // Don't add to state here - let WebSocket handle it
      setNewObjective('')
      setIsCreateDialogOpen(false)
    } catch (err: any) {
      console.error('Error creating initiative:', err)
      setError(err.message || 'Failed to create initiative')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteInitiative = async () => {
    if (!deleteInitiativeId) return

    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/initiatives/${deleteInitiativeId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        let errorMessage = 'Failed to delete initiative'
        try {
          const data = await response.json()
          errorMessage = data.error?.message || data.error || errorMessage
        } catch (jsonError) {
          // If JSON parsing fails, use the default error message
          console.error('Failed to parse error response:', jsonError)
        }
        throw new Error(errorMessage)
      }

      // Only try to parse JSON if content-type indicates JSON
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          await response.json() // Consume the response body if it exists
        } catch (jsonError) {
          // Ignore JSON parsing errors for successful responses
          console.warn('Response body is not valid JSON, but request was successful')
        }
      }

      setInitiatives(prev => prev.filter(i => i.id !== deleteInitiativeId))
      setDeleteInitiativeId(null)
    } catch (err: any) {
      console.error('Error deleting initiative:', err)
      setError(err.message || 'Failed to delete initiative')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCompleteInitiative = async (id: string) => {
    try {
      const response = await fetch(`/api/initiatives/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          phase: 'ready',
          isActive: false,
          completedAt: new Date().toISOString()
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to complete initiative')
      }

      fetchInitiatives()
    } catch (err: any) {
      console.error('Error completing initiative:', err)
      setError(err.message || 'Failed to complete initiative')
    }
  }

  // Filter initiatives based on search and status - memoized for performance
  const filteredInitiatives = useMemo(() => {
    return initiatives.filter(initiative => {
      // Search filter
      const matchesSearch = debouncedSearchQuery === '' || 
        initiative.objective.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        initiative.id.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
      
      // Status filter
      const status = getStatusFromPhase(initiative.phase)
      const isCompleted = initiative.phase === 'ready' || !initiative.isActive
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && !isCompleted) ||
        (statusFilter === 'completed' && isCompleted) ||
        (statusFilter === status)
      
      return matchesSearch && matchesStatus
    })
  }, [initiatives, debouncedSearchQuery, statusFilter])

  if (isLoading) {
    return (
      <div className="w-full px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Initiatives</CardTitle>
                </div>
                <CardDescription>
                  Manage your development initiatives and track their progress
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <InitiativeListSkeleton />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="w-full px-4 py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Initiatives</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Initiatives help you break down complex objectives into well-planned tasks through a guided workflow.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <CardDescription>
                Manage your development initiatives and track their progress
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <InitiativeHelpModal />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Initiative
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Start a new initiative to plan your next feature</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search initiatives..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                aria-label="Search initiatives"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-md border border-input bg-background text-sm"
                aria-label="Filter by status"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="exploring">Exploring</option>
                <option value="awaiting_answers">Awaiting Answers</option>
                <option value="researching">Researching</option>
                <option value="planning">Planning</option>
              </select>
            </div>
          </div>

          {initiatives.length === 0 ? (
            <InitiativesEmptyState onCreateClick={() => setIsCreateDialogOpen(true)} />
          ) : filteredInitiatives.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No initiatives match your search criteria</p>
              <Button variant="outline" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile view - Cards */}
              <div className="block sm:hidden space-y-4">
                {filteredInitiatives.map((initiative) => {
                  const status = getStatusFromPhase(initiative.phase)
                  const isCompleted = initiative.phase === 'ready' || !initiative.isActive
                  
                  return (
                    <Card key={initiative.id} className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium text-sm line-clamp-2 flex-1">
                            {initiative.objective}
                          </h3>
                          <Badge variant={getStatusBadgeVariant(isCompleted ? 'completed' : status)} className="text-xs">
                            {isCompleted ? 'Done' : status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatPhase(initiative.phase)}</span>
                          <span>{new Date(initiative.createdAt).toLocaleDateString()}</span>
                        </div>
                        
                        <div className="flex items-center justify-end gap-1 pt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                          >
                            <Link href={`/initiative/${initiative.id}`} aria-label={`View initiative: ${initiative.objective}`}>
                              <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
                              View
                            </Link>
                          </Button>
                          {!isCompleted && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCompleteInitiative(initiative.id)}
                              aria-label={`Complete initiative: ${initiative.objective}`}
                            >
                              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteInitiativeId(initiative.id)}
                            aria-label={`Delete initiative: ${initiative.objective}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
              
              {/* Desktop view - Table */}
              <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%] min-w-[200px]">Objective</TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">
                      <div className="flex items-center gap-1">
                        Status
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3 h-3 text-gray-400 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Current processing status of the initiative</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">
                      <div className="flex items-center gap-1">
                        Phase
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3 h-3 text-gray-400 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Current workflow phase (Exploration → Questions → Research → Tasks → Ready)</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">Created</TableHead>
                    <TableHead className="w-[15%] min-w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInitiatives.map((initiative) => {
                    const status = getStatusFromPhase(initiative.phase)
                    const isCompleted = initiative.phase === 'ready' || !initiative.isActive

                    return (
                      <TableRow key={initiative.id}>
                        <TableCell>
                          <div className="max-w-sm">
                            <p 
                              className="truncate font-medium"
                              title={initiative.objective}
                            >
                              {initiative.objective}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(isCompleted ? 'completed' : status)}>
                            {isCompleted ? 'Completed' : status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {formatPhase(initiative.phase)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {new Date(initiative.createdAt).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View Initiative"
                              asChild
                            >
                              <Link href={`/initiative/${initiative.id}`} aria-label={`View initiative: ${initiative.objective}`}>
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              </Link>
                            </Button>
                            {!isCompleted && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Complete Initiative"
                                onClick={() => handleCompleteInitiative(initiative.id)}
                                aria-label={`Complete initiative: ${initiative.objective}`}
                              >
                                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete Initiative"
                              onClick={() => setDeleteInitiativeId(initiative.id)}
                              aria-label={`Delete initiative: ${initiative.objective}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Initiative Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>Create New Initiative</DialogTitle>
            <DialogDescription>
              Define a clear objective for your initiative. This will guide the exploration and planning process.
            </DialogDescription>
            <div className="mt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="mb-2">Tips for good objectives:</p>
                  <ul className="list-disc list-inside text-sm">
                    <li>Be specific about what you want to achieve</li>
                    <li>Include scope and constraints</li>
                    <li>Focus on a single feature or improvement</li>
                    <li>Example: "Add user authentication with JWT tokens and email/password login"</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="objective">Objective</Label>
              <Textarea
                id="objective"
                value={newObjective}
                onChange={(e) => setNewObjective(e.target.value)}
                placeholder="Describe what you want to achieve..."
                className="min-h-[100px]"
                disabled={isCreating}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateInitiative}
              disabled={!newObjective.trim() || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Initiative'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteInitiativeId} onOpenChange={(open) => !open && setDeleteInitiativeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Initiative</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this initiative? This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteInitiative}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </TooltipProvider>
  )
}