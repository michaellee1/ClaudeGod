import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateObjective } from '@/lib/utils/initiative-validation'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { ValidationError, InitiativeLimitExceededError } from '@/lib/utils/errors'

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

    return NextResponse.json({
      id: initiative.id,
      status: 'created',
      phase: initiative.phase,
      objective: initiative.objective,
      createdAt: initiative.createdAt
    })
})

export const GET = withErrorHandler(async () => {
    const initiatives = initiativeStore.getAll()
    
    // Transform initiatives for API response
    const apiInitiatives = initiatives.map(initiative => ({
      id: initiative.id,
      objective: initiative.objective,
      phase: initiative.phase,
      status: initiative.isActive ? 'active' : 'completed',
      createdAt: initiative.createdAt,
      updatedAt: initiative.updatedAt,
      progress: {
        phase: initiative.phase,
        tasksCreated: (initiative.phaseData?.tasksCreated as number) || 0,
        isComplete: initiative.phase === 'ready'
      }
    }))

    return NextResponse.json(apiInitiatives)
})

// Prevent static caching
export const dynamic = 'force-dynamic'