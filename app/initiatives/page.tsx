'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { Initiative } from '@/lib/utils/initiative-store'
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
import { Eye, Trash2, CheckCircle2, Plus, Loader2 } from 'lucide-react'

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
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newObjective, setNewObjective] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deleteInitiativeId, setDeleteInitiativeId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // WebSocket for real-time updates
  const { lastMessage } = useInitiativeWebSocket('/ws', {
    onInitiativeUpdate: (initiative) => {
      setInitiatives(prev => {
        const index = prev.findIndex(i => i.id === initiative.id)
        if (index >= 0) {
          const updated = [...prev]
          updated[index] = initiative
          return updated
        }
        return [...prev, initiative]
      })
    },
    onInitiativeRemoved: (initiativeId) => {
      setInitiatives(prev => prev.filter(i => i.id !== initiativeId))
    }
  })

  // Fetch initiatives on mount
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
    if (!newObjective.trim()) return

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
        throw new Error(data.error || 'Failed to create initiative')
      }

      const newInitiative = await response.json()
      setInitiatives(prev => [newInitiative, ...prev])
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
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete initiative')
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

  if (isLoading) {
    return (
      <div className="w-full px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-4 py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Initiatives</CardTitle>
              <CardDescription>
                Manage your development initiatives and track their progress
              </CardDescription>
            </div>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Initiative
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {initiatives.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No initiatives created yet</p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                Create your first initiative
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%] min-w-[200px]">Objective</TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">Status</TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">Phase</TableHead>
                    <TableHead className="w-[15%] min-w-[120px]">Created</TableHead>
                    <TableHead className="w-[15%] min-w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initiatives.map((initiative) => {
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
                              <Link href={`/initiatives/${initiative.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            {!isCompleted && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Complete Initiative"
                                onClick={() => handleCompleteInitiative(initiative.id)}
                              >
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete Initiative"
                              onClick={() => setDeleteInitiativeId(initiative.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
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
  )
}