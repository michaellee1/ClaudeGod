import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { objective } = body

    if (!objective || typeof objective !== 'string' || objective.trim().length === 0) {
      return NextResponse.json(
        { error: 'Objective is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    // Validate objective length
    if (objective.length > 5000) {
      return NextResponse.json(
        { error: 'Objective must be less than 5000 characters' },
        { status: 400 }
      )
    }

    // Create new initiative
    const initiative = await initiativeStore.createInitiative(objective.trim())

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
  } catch (error: any) {
    console.error('Error creating initiative:', error)
    
    // Check for resource limit error
    if (error.message?.includes('Resource limit reached')) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      )
    }
    
    return NextResponse.json(
      { error: error.message || 'Failed to create initiative' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
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
  } catch (error: any) {
    console.error('Error listing initiatives:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list initiatives' },
      { status: 500 }
    )
  }
}

// Prevent static caching
export const dynamic = 'force-dynamic'