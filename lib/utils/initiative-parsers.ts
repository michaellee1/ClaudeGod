import { InitiativeQuestion, InitiativeTaskStep } from '@/lib/types/initiative'

/**
 * Parse questions from exploration phase markdown output
 * Expects markdown with questions in various formats:
 * - Numbered lists (1. Question?)
 * - Bullet points (- Question?)
 * - Markdown headers (### Question?)
 * - Question blocks with categories
 */
export function parseQuestions(content: string): InitiativeQuestion[] {
  if (!content || typeof content !== 'string') {
    console.warn('[parseQuestions] Invalid content provided:', content)
    return []
  }

  const questions: InitiativeQuestion[] = []
  const lines = content.split('\n')
  
  // Patterns to identify questions
  const questionPatterns = [
    // Numbered list: "1. What is...?"
    /^\s*\d+\.\s+(.+\?)\s*$/,
    // Bullet point: "- What is...?"
    /^\s*[-*]\s+(.+\?)\s*$/,
    // Header with question: "### What is...?"
    /^\s*#{1,6}\s+(.+\?)\s*$/,
    // Plain question line
    /^(.+\?)\s*$/
  ]
  
  let currentCategory: string | undefined
  let questionId = 1
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    // Skip empty lines
    if (!line) continue
    
    // Check for category headers (e.g., "## Technical Questions")
    const categoryMatch = line.match(/^#{1,3}\s+(.+?)(?:\s+Questions?)?$/i)
    if (categoryMatch && !line.includes('?')) {
      currentCategory = categoryMatch[1].trim()
      continue
    }
    
    // Try to match question patterns
    for (const pattern of questionPatterns) {
      const match = line.match(pattern)
      if (match) {
        const questionText = match[1].trim()
        
        // Skip if it's too short or doesn't look like a real question
        if (questionText.length < 10) continue
        
        // Determine priority based on keywords or position
        let priority: 'high' | 'medium' | 'low' = 'medium'
        if (questionText.toLowerCase().includes('critical') || 
            questionText.toLowerCase().includes('must') ||
            questionText.toLowerCase().includes('require')) {
          priority = 'high'
        } else if (questionText.toLowerCase().includes('optional') ||
                   questionText.toLowerCase().includes('nice to have')) {
          priority = 'low'
        }
        
        questions.push({
          id: `q${questionId++}`,
          question: questionText,
          category: currentCategory,
          priority,
          createdAt: new Date()
        })
        
        break // Found a match, move to next line
      }
    }
  }
  
  // Log results for debugging
  console.log(`[parseQuestions] Parsed ${questions.length} questions from ${lines.length} lines`)
  if (questions.length === 0) {
    console.warn('[parseQuestions] No questions found in content:', content.substring(0, 200))
  }
  
  return questions
}

/**
 * Parse task plan from final task generation phase output
 * Expects JSON structure with globalContext and steps
 */
export function parseTaskPlan(content: string): { globalContext: string, steps: InitiativeTaskStep[] } {
  if (!content || typeof content !== 'string') {
    console.error('[parseTaskPlan] Invalid content provided')
    throw new Error('Invalid content: expected non-empty string')
  }

  try {
    // Try to extract JSON from content
    // Content might have markdown or other text around it
    const jsonMatch = content.match(/\{[\s\S]*\}/m)
    if (!jsonMatch) {
      // Try to find JSON array for steps
      const arrayMatch = content.match(/\[[\s\S]*\]/m)
      if (arrayMatch) {
        const steps = JSON.parse(arrayMatch[0])
        return {
          globalContext: '',
          steps: validateAndTransformSteps(steps)
        }
      }
      throw new Error('No JSON content found in output')
    }
    
    const parsed = JSON.parse(jsonMatch[0])
    
    // Validate required fields
    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error('Missing or invalid "steps" array in task plan')
    }
    
    const globalContext = parsed.globalContext || parsed.context || ''
    const steps = validateAndTransformSteps(parsed.steps)
    
    console.log(`[parseTaskPlan] Successfully parsed ${steps.length} steps`)
    
    return { globalContext, steps }
  } catch (error) {
    console.error('[parseTaskPlan] Parse error:', error)
    console.error('[parseTaskPlan] Content preview:', content.substring(0, 500))
    throw new Error(`Failed to parse task plan: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Validate and transform steps to ensure they match InitiativeTaskStep interface
 */
function validateAndTransformSteps(steps: any[]): InitiativeTaskStep[] {
  if (!Array.isArray(steps)) {
    throw new Error('Steps must be an array')
  }
  
  return steps.map((step, index) => {
    // Validate required fields
    if (!step.name || typeof step.name !== 'string') {
      throw new Error(`Step ${index + 1} missing required field: name`)
    }
    
    // Transform tasks if present
    let tasks = []
    if (step.tasks && Array.isArray(step.tasks)) {
      tasks = step.tasks.map((task: any, taskIndex: number) => {
        if (!task.title || !task.description) {
          console.warn(`Task ${taskIndex + 1} in step "${step.name}" missing required fields`)
        }
        
        return {
          id: task.id || `task-${index}-${taskIndex}`,
          title: task.title || 'Untitled Task',
          description: task.description || '',
          priority: validatePriority(task.priority),
          dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
          estimatedEffort: task.estimatedEffort || task.effort || undefined,
          status: 'pending' as const,
          createdAt: new Date()
        }
      })
    }
    
    return {
      id: step.id || `step-${index + 1}`,
      name: step.name,
      description: step.description || '',
      order: typeof step.order === 'number' ? step.order : index + 1,
      tasks,
      status: 'pending' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
}

/**
 * Validate priority value
 */
function validatePriority(priority: any): 'high' | 'medium' | 'low' {
  const validPriorities = ['high', 'medium', 'low']
  if (validPriorities.includes(priority)) {
    return priority
  }
  return 'medium'
}

/**
 * Parse research needs document (markdown format)
 * Returns the raw content as it will be used as-is
 */
export function parseResearchNeeds(content: string): string {
  if (!content || typeof content !== 'string') {
    console.warn('[parseResearchNeeds] Invalid content provided')
    return ''
  }
  
  // Simply return trimmed content - the research needs document
  // is free-form markdown that will be provided to the user
  return content.trim()
}

/**
 * Helper function to extract JSON from mixed content
 */
export function extractJSON(content: string): any {
  // Try multiple strategies to extract JSON
  const strategies = [
    // Strategy 1: Direct parse
    () => JSON.parse(content),
    
    // Strategy 2: Extract first JSON object
    () => {
      const match = content.match(/\{[\s\S]*\}/m)
      return match ? JSON.parse(match[0]) : null
    },
    
    // Strategy 3: Extract JSON array
    () => {
      const match = content.match(/\[[\s\S]*\]/m)
      return match ? JSON.parse(match[0]) : null
    },
    
    // Strategy 4: Look for code blocks
    () => {
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/m)
      return codeBlockMatch ? JSON.parse(codeBlockMatch[1]) : null
    }
  ]
  
  for (const strategy of strategies) {
    try {
      const result = strategy()
      if (result !== null) {
        return result
      }
    } catch (error) {
      // Continue to next strategy
    }
  }
  
  throw new Error('No valid JSON found in content')
}

/**
 * Validate output for completeness
 */
export function validateOutput(output: string, phase: string): { valid: boolean, error?: string } {
  if (!output || output.trim().length === 0) {
    return { valid: false, error: 'Output is empty' }
  }
  
  // Phase-specific validation
  switch (phase) {
    case 'exploration':
      const questions = parseQuestions(output)
      if (questions.length === 0) {
        return { valid: false, error: 'No questions found in exploration output' }
      }
      break
      
    case 'task_generation':
      try {
        const { steps } = parseTaskPlan(output)
        if (steps.length === 0) {
          return { valid: false, error: 'No task steps found in output' }
        }
      } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : 'Invalid task plan format' }
      }
      break
  }
  
  return { valid: true }
}