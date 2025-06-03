import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateObjective } from '@/lib/utils/initiative-validation'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { ValidationError, InitiativeLimitExceededError } from '@/lib/utils/errors'
import { InitiativePhase, InitiativeStatus } from '@/lib/types/initiative'

export const POST = withErrorHandler(async (request: NextRequest) => {
    let body;
    try {
      body = await request.json()
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body')
    }
    
    const { objective, repositoryPath } = body

    if (!objective || typeof objective !== 'string' || objective.trim().length === 0) {
      throw new ValidationError('Objective is required and must be a non-empty string', 'objective')
    }

    // Repository path is optional but recommended
    if (repositoryPath && typeof repositoryPath !== 'string') {
      throw new ValidationError('Repository path must be a string', 'repositoryPath')
    }

    // Validate objective using validation utility
    const objectiveError = validateObjective(objective)
    if (objectiveError) {
      throw new ValidationError(
        objectiveError.message,
        objectiveError.field,
        objective
      )
    }

    // Create new initiative
    let initiative;
    try {
      initiative = await initiativeStore.createInitiative(objective.trim(), repositoryPath?.trim())
    } catch (error: any) {
      if (error.message?.includes('Resource limit reached')) {
        const match = error.message.match(/(\d+)\/(\d+)/)
        if (match) {
          throw new InitiativeLimitExceededError(parseInt(match[2]), parseInt(match[1]))
        }
      }
      throw error
    }

    // Start exploration phase with a small delay to ensure WebSocket connection is established
    const manager = InitiativeManager.getInstance()
    
    // Broadcast initial status
    if ((global as any).broadcastInitiativeOutput) {
      (global as any).broadcastInitiativeOutput(initiative.id, {
        type: 'info',
        phase: InitiativePhase.EXPLORATION,
        content: 'Starting exploration phase...',
        timestamp: new Date()
      })
    }
    
    // Small delay to ensure WebSocket clients are connected
    await new Promise(resolve => setTimeout(resolve, 500))
    
    try {
      await manager.startExploration(initiative.id)
    } catch (error: any) {
      // If exploration fails to start, remove the initiative
      await initiativeStore.delete(initiative.id)
      throw error
    }

    // Reload the initiative to get the updated processId
    const updatedInitiative = initiativeStore.get(initiative.id)
    if (!updatedInitiative) {
      throw new Error('Initiative not found after creation')
    }

    // Map InitiativePhase enum back to string for backward compatibility
    const phaseToString: Record<string, string> = {
      [InitiativePhase.EXPLORATION]: 'exploration',
      [InitiativePhase.QUESTIONS]: 'questions',
      [InitiativePhase.RESEARCH_PREP]: 'research_prep',
      [InitiativePhase.RESEARCH_REVIEW]: 'research_review',
      [InitiativePhase.TASK_GENERATION]: 'task_generation',
      [InitiativePhase.READY]: 'ready'
    }
    
    const phaseString = phaseToString[updatedInitiative.currentPhase] || 'exploration'
    
    return NextResponse.json({
      id: updatedInitiative.id,
      status: updatedInitiative.status,
      phase: phaseString,
      objective: updatedInitiative.objective,
      repositoryPath: updatedInitiative.repositoryPath,
      createdAt: updatedInitiative.createdAt,
      updatedAt: updatedInitiative.updatedAt,
      isActive: true,
      processId: updatedInitiative.processId,
      yoloMode: updatedInitiative.yoloMode
    })
})

export const GET = withErrorHandler(async () => {
    const initiatives = initiativeStore.getAll()
    
    // Transform initiatives for API response - need to map internal phase to string
    const apiInitiatives = initiatives.map(initiative => {
      // Map InitiativePhase enum back to string for backward compatibility
      const phaseToString: Record<string, string> = {
        [InitiativePhase.EXPLORATION]: 'exploration',
        [InitiativePhase.QUESTIONS]: 'questions',
        [InitiativePhase.RESEARCH_PREP]: 'research_prep',
        [InitiativePhase.RESEARCH_REVIEW]: 'research_review',
        [InitiativePhase.TASK_GENERATION]: 'task_generation',
        [InitiativePhase.READY]: 'ready'
      }
      
      const phaseString = phaseToString[initiative.currentPhase] || 'exploration'
      const isActive = initiative.status !== InitiativeStatus.COMPLETED && initiative.status !== InitiativeStatus.TASKS_SUBMITTED && initiative.status !== InitiativeStatus.FAILED
      
      return {
        id: initiative.id,
        objective: initiative.objective,
        repositoryPath: initiative.repositoryPath,
        phase: phaseString,
        status: initiative.status,
        createdAt: initiative.createdAt,
        updatedAt: initiative.updatedAt,
        isActive,
        processId: initiative.processId,
        yoloMode: initiative.yoloMode,
        currentStepIndex: initiative.currentStepIndex
      }
    })

    return NextResponse.json(apiInitiatives)
})

// Prevent static caching
export const dynamic = 'force-dynamic'