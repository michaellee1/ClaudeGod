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
    
    const { objective } = body

    if (!objective || typeof objective !== 'string' || objective.trim().length === 0) {
      throw new ValidationError('Objective is required and must be a non-empty string', 'objective')
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
      initiative = await initiativeStore.createInitiative(objective.trim())
    } catch (error: any) {
      if (error.message?.includes('Resource limit reached')) {
        const match = error.message.match(/(\d+)\/(\d+)/)
        if (match) {
          throw new InitiativeLimitExceededError(parseInt(match[2]), parseInt(match[1]))
        }
      }
      throw error
    }

    // Start exploration phase
    const manager = InitiativeManager.getInstance()
    try {
      await manager.startExploration(initiative.id)
    } catch (error: any) {
      // If exploration fails to start, remove the initiative
      await initiativeStore.delete(initiative.id)
      throw error
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
    
    const phaseString = phaseToString[initiative.currentPhase] || 'exploration'
    
    return NextResponse.json({
      id: initiative.id,
      status: initiative.status,
      phase: phaseString,
      objective: initiative.objective,
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      isActive: true,
      yoloMode: initiative.yoloMode
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
      const isActive = initiative.status !== InitiativeStatus.COMPLETED && initiative.status !== InitiativeStatus.TASKS_SUBMITTED
      
      return {
        id: initiative.id,
        objective: initiative.objective,
        phase: phaseString,
        status: initiative.status,
        createdAt: initiative.createdAt,
        updatedAt: initiative.updatedAt,
        isActive,
        yoloMode: initiative.yoloMode,
        currentStepIndex: initiative.currentStepIndex
      }
    })

    return NextResponse.json(apiInitiatives)
})

// Prevent static caching
export const dynamic = 'force-dynamic'