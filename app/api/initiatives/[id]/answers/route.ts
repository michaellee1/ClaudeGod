import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { validateAnswers, VALIDATION_LIMITS, InitiativeAnswer } from '@/lib/utils/initiative-validation'

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
    const { answers } = body

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return NextResponse.json(
        { error: 'Answers must be provided as an object' },
        { status: 400 }
      )
    }

    // Validate all answers are strings and convert to InitiativeAnswer format
    const answerArray: InitiativeAnswer[] = []
    for (const [key, value] of Object.entries(answers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return NextResponse.json(
          { error: 'All answer keys and values must be strings' },
          { status: 400 }
        )
      }
      answerArray.push({ questionId: key, text: value })
    }

    // Validate answers using validation utility
    const answerErrors = validateAnswers(answerArray)
    if (answerErrors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Answer validation failed',
          errors: answerErrors.map(err => ({
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

    if (initiative.phase !== 'questions') {
      return NextResponse.json(
        { error: `Cannot submit answers in phase: ${initiative.phase}. Initiative must be in 'questions' phase.` },
        { status: 400 }
      )
    }

    // Process answers and trigger refinement phase
    const manager = InitiativeManager.getInstance()
    await manager.processAnswers(id, answers)

    // Get updated initiative
    const updatedInitiative = initiativeStore.get(id)
    if (!updatedInitiative) {
      throw new Error('Initiative not found after update')
    }

    return NextResponse.json({
      id: updatedInitiative.id,
      phase: updatedInitiative.phase,
      status: 'answers_submitted',
      message: 'Answers submitted successfully. Research preparation phase started.'
    })
  } catch (error: any) {
    console.error('Error submitting answers:', error)
    
    // Check for resource limit error
    if (error.message?.includes('Resource limit reached')) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      )
    }
    
    return NextResponse.json(
      { error: error.message || 'Failed to submit answers' },
      { status: 500 }
    )
  }
}

// Prevent static caching
export const dynamic = 'force-dynamic'