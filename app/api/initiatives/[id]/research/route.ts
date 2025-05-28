import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateResearch, VALIDATION_LIMITS } from '@/lib/utils/initiative-validation'
import { InitiativeResearch } from '@/lib/types/initiative'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Invalid initiative ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { research } = body

    if (!research || typeof research !== 'string' || research.trim().length === 0) {
      return NextResponse.json(
        { error: 'Research must be provided as a non-empty string' },
        { status: 400 }
      )
    }

    // Validate research using validation utility
    const researchData: InitiativeResearch = {
      id: 'temp',
      topic: 'User Research',
      description: research.trim(),
      findings: research.trim(),
      createdAt: new Date()
    }
    const researchErrors = validateResearch(researchData)
    if (researchErrors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Research validation failed',
          errors: researchErrors.map(err => ({
            field: err.field,
            message: err.message,
            constraint: err.constraint,
            details: err.details
          }))
        },
        { status: 400 }
      )
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      return NextResponse.json(
        { error: 'Initiative not found' },
        { status: 404 }
      )
    }

    if (initiative.phase !== 'research_review') {
      return NextResponse.json(
        { error: `Cannot submit research in phase: ${initiative.phase}. Initiative must be in 'research_review' phase.` },
        { status: 400 }
      )
    }

    // Process research and trigger planning phase
    const manager = InitiativeManager.getInstance()
    await manager.processResearch(id, research.trim())

    // Get updated initiative
    const updatedInitiative = initiativeStore.get(id)
    if (!updatedInitiative) {
      throw new Error('Initiative not found after update')
    }

    return NextResponse.json({
      id: updatedInitiative.id,
      phase: updatedInitiative.phase,
      status: 'research_submitted',
      message: 'Research submitted successfully. Task generation phase started.'
    })
  } catch (error: any) {
    console.error('Error submitting research:', error)
    
    // Check for resource limit error
    if (error.message?.includes('Resource limit reached')) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      )
    }
    
    return NextResponse.json(
      { error: error.message || 'Failed to submit research' },
      { status: 500 }
    )
  }
}

// Prevent static caching
export const dynamic = 'force-dynamic'