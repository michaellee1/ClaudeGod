import {
  Initiative,
  InitiativeStatus,
  InitiativePhase,
  InitiativeQuestion,
  InitiativeResearch,
  InitiativePlan,
  InitiativeTask,
  InitiativeTaskStep
} from '../types/initiative';

// Validation Constants
const VALIDATION_LIMITS = {
  OBJECTIVE_MIN_LENGTH: 10,
  OBJECTIVE_MAX_LENGTH: 500,
  QUESTION_MIN_LENGTH: 10,
  QUESTION_MAX_LENGTH: 500,
  ANSWER_MIN_LENGTH: 1,
  ANSWER_MAX_LENGTH: 2000,
  RESEARCH_MIN_LENGTH: 10,
  RESEARCH_MAX_LENGTH: 10000,
  TASK_TITLE_MIN_LENGTH: 5,
  TASK_TITLE_MAX_LENGTH: 200,
  TASK_DESCRIPTION_MIN_LENGTH: 10,
  TASK_DESCRIPTION_MAX_LENGTH: 2000,
  STEP_DESCRIPTION_MIN_LENGTH: 5,
  STEP_DESCRIPTION_MAX_LENGTH: 500,
  MAX_QUESTIONS: 10,
  MAX_TASKS: 50,
  MAX_STEPS_PER_TASK: 20,
  FILE_NAME_MAX_LENGTH: 255,
  FILE_PATH_MAX_LENGTH: 4096,
  MAX_FILES_PER_PHASE: 100
} as const;

// Validation Error Types
export class ValidationError extends Error {
  constructor(
    public field: string,
    public value: any,
    public constraint: string,
    public details?: string
  ) {
    super(`Validation failed for ${field}: ${constraint}${details ? ` - ${details}` : ''}`);
    this.name = 'ValidationError';
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

// Type Guards
export function isValidInitiativeStatus(status: string): status is InitiativeStatus {
  return Object.values(InitiativeStatus).includes(status as InitiativeStatus);
}

export function isValidInitiativePhase(phase: string): phase is InitiativePhase {
  return Object.values(InitiativePhase).includes(phase as InitiativePhase);
}


// Objective Validation
export function validateObjective(objective: string): ValidationError | null {
  return validateStringLength(
    objective,
    'objective',
    VALIDATION_LIMITS.OBJECTIVE_MIN_LENGTH,
    VALIDATION_LIMITS.OBJECTIVE_MAX_LENGTH
  );
}

// Question Validation
export function validateQuestion(question: InitiativeQuestion, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!question.id || typeof question.id !== 'string') {
    errors.push(new ValidationError(`questions[${index}].id`, question.id, 'must be a non-empty string'));
  }
  
  const textError = validateStringLength(
    question.question,
    `questions[${index}].question`,
    VALIDATION_LIMITS.QUESTION_MIN_LENGTH,
    VALIDATION_LIMITS.QUESTION_MAX_LENGTH
  );
  if (textError) errors.push(textError);
  
  // Note: answered field doesn't exist in the actual InitiativeQuestion type
  
  return errors;
}

export function validateQuestions(questions: InitiativeQuestion[]): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(questions)) {
    errors.push(new ValidationError('questions', questions, 'must be an array'));
    return errors;
  }
  
  if (questions.length === 0) {
    errors.push(new ValidationError('questions', questions, 'must contain at least one question'));
  }
  
  if (questions.length > VALIDATION_LIMITS.MAX_QUESTIONS) {
    errors.push(new ValidationError('questions', questions, `cannot exceed ${VALIDATION_LIMITS.MAX_QUESTIONS} questions`));
  }
  
  questions.forEach((question, index) => {
    errors.push(...validateQuestion(question, index));
  });
  
  return errors;
}

// Answer Validation
export interface InitiativeAnswer {
  questionId: string;
  text: string;
}

export function validateAnswer(answer: InitiativeAnswer): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!answer.questionId || typeof answer.questionId !== 'string') {
    errors.push(new ValidationError('answer.questionId', answer.questionId, 'must be a non-empty string'));
  }
  
  const textError = validateStringLength(
    answer.text,
    'answer.text',
    VALIDATION_LIMITS.ANSWER_MIN_LENGTH,
    VALIDATION_LIMITS.ANSWER_MAX_LENGTH
  );
  if (textError) errors.push(textError);
  
  return errors;
}

export function validateAnswers(answers: InitiativeAnswer[]): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(answers)) {
    errors.push(new ValidationError('answers', answers, 'must be an array'));
    return errors;
  }
  
  answers.forEach((answer, index) => {
    const answerErrors = validateAnswer(answer);
    answerErrors.forEach(error => {
      error.field = `answers[${index}].${error.field.replace('answer.', '')}`;
    });
    errors.push(...answerErrors);
  });
  
  return errors;
}

// Research Validation
export function validateResearch(research: InitiativeResearch): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const contentError = validateStringLength(
    research.description || research.findings || '',
    'research.description',
    VALIDATION_LIMITS.RESEARCH_MIN_LENGTH,
    VALIDATION_LIMITS.RESEARCH_MAX_LENGTH
  );
  if (contentError) errors.push(contentError);
  
  if (!research.createdAt || isNaN(new Date(research.createdAt).getTime())) {
    errors.push(new ValidationError('research.createdAt', research.createdAt, 'must be a valid date'));
  }
  
  return errors;
}

// Task Step Validation for individual task steps
export interface InitiativeStep {
  description: string;
  completed: boolean;
}

export function validateStep(step: InitiativeStep, taskIndex: number, stepIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const descriptionError = validateStringLength(
    step.description,
    `tasks[${taskIndex}].steps[${stepIndex}].description`,
    VALIDATION_LIMITS.STEP_DESCRIPTION_MIN_LENGTH,
    VALIDATION_LIMITS.STEP_DESCRIPTION_MAX_LENGTH
  );
  if (descriptionError) errors.push(descriptionError);
  
  if (typeof step.completed !== 'boolean') {
    errors.push(new ValidationError(`tasks[${taskIndex}].steps[${stepIndex}].completed`, step.completed, 'must be a boolean'));
  }
  
  return errors;
}

// Task Validation
export function validateTask(task: InitiativeTask, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!task.id || typeof task.id !== 'string') {
    errors.push(new ValidationError(`tasks[${index}].id`, task.id, 'must be a non-empty string'));
  }
  
  const titleError = validateStringLength(
    task.title,
    `tasks[${index}].title`,
    VALIDATION_LIMITS.TASK_TITLE_MIN_LENGTH,
    VALIDATION_LIMITS.TASK_TITLE_MAX_LENGTH
  );
  if (titleError) errors.push(titleError);
  
  const descriptionError = validateStringLength(
    task.description,
    `tasks[${index}].description`,
    VALIDATION_LIMITS.TASK_DESCRIPTION_MIN_LENGTH,
    VALIDATION_LIMITS.TASK_DESCRIPTION_MAX_LENGTH
  );
  if (descriptionError) errors.push(descriptionError);
  
  if (!['high', 'medium', 'low'].includes(task.priority)) {
    errors.push(new ValidationError(`tasks[${index}].priority`, task.priority, 'must be high, medium, or low'));
  }
  
  return errors;
}

export function validateTasks(tasks: InitiativeTask[]): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(tasks)) {
    errors.push(new ValidationError('tasks', tasks, 'must be an array'));
    return errors;
  }
  
  if (tasks.length === 0) {
    errors.push(new ValidationError('tasks', tasks, 'must contain at least one task'));
  }
  
  if (tasks.length > VALIDATION_LIMITS.MAX_TASKS) {
    errors.push(new ValidationError('tasks', tasks, `cannot exceed ${VALIDATION_LIMITS.MAX_TASKS} tasks`));
  }
  
  tasks.forEach((task, index) => {
    errors.push(...validateTask(task, index));
  });
  
  return errors;
}

// Plan Validation
export function validatePlan(plan: InitiativePlan): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const overviewError = validateStringLength(
    plan.objective,
    'plan.objective',
    VALIDATION_LIMITS.TASK_DESCRIPTION_MIN_LENGTH,
    VALIDATION_LIMITS.TASK_DESCRIPTION_MAX_LENGTH
  );
  if (overviewError) errors.push(overviewError);
  
  if (!plan.scope || typeof plan.scope !== 'string') {
    errors.push(new ValidationError('plan.scope', plan.scope, 'must be a non-empty string'));
  }
  
  if (!plan.approach || typeof plan.approach !== 'string') {
    errors.push(new ValidationError('plan.approach', plan.approach, 'must be a non-empty string'));
  }
  
  return errors;
}

// File Path Validation
export function validateFilePath(path: string): ValidationError | null {
  if (!path || typeof path !== 'string') {
    return new ValidationError('filePath', path, 'must be a non-empty string');
  }
  
  if (path.length > VALIDATION_LIMITS.FILE_PATH_MAX_LENGTH) {
    return new ValidationError('filePath', path, `must be at most ${VALIDATION_LIMITS.FILE_PATH_MAX_LENGTH} characters`);
  }
  
  // Check for path traversal attempts
  if (path.includes('..') || path.includes('~')) {
    return new ValidationError('filePath', path, 'must not contain path traversal sequences');
  }
  
  // Check for invalid characters
  const invalidChars = /[\0\x08\x09\x1a\n\r"*?<>|]/;
  if (invalidChars.test(path)) {
    return new ValidationError('filePath', path, 'contains invalid characters');
  }
  
  return null;
}

// Initiative Validation
export function validateInitiative(initiative: Partial<Initiative>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  
  // Required fields
  if (!initiative.id || typeof initiative.id !== 'string') {
    errors.push(new ValidationError('id', initiative.id, 'must be a non-empty string'));
  }
  
  if (initiative.objective) {
    const objError = validateObjective(initiative.objective);
    if (objError) errors.push(objError);
  } else {
    errors.push(new ValidationError('objective', initiative.objective, 'is required'));
  }
  
  if (initiative.status && !isValidInitiativeStatus(initiative.status)) {
    errors.push(new ValidationError('status', initiative.status, `must be one of: ${Object.values(InitiativeStatus).join(', ')}`));
  }
  
  if (initiative.currentPhase && !isValidInitiativePhase(initiative.currentPhase)) {
    errors.push(new ValidationError('currentPhase', initiative.currentPhase, `must be one of: ${Object.values(InitiativePhase).join(', ')}`));
  }
  
  // Optional fields
  if (initiative.questions) {
    errors.push(...validateQuestions(initiative.questions));
  }
  
  if (initiative.userAnswers) {
    // Convert Record<string, string> to InitiativeAnswer[]
    const answers = Object.entries(initiative.userAnswers).map(([questionId, text]) => ({ questionId, text }));
    errors.push(...validateAnswers(answers));
  }
  
  // Research validation - note that the actual type doesn't have a research field
  // but has researchNeeds and researchResults
  
  if (initiative.plan) {
    errors.push(...validatePlan(initiative.plan));
  }
  
  if (initiative.taskSteps) {
    // Validate task steps
    initiative.taskSteps.forEach((step, index) => {
      if (!step.name || typeof step.name !== 'string') {
        errors.push(new ValidationError(`taskSteps[${index}].name`, step.name, 'must be a non-empty string'));
      }
      if (step.tasks && Array.isArray(step.tasks)) {
        errors.push(...validateTasks(step.tasks));
      }
    });
  }
  
  // Warnings
  if ((initiative.status === InitiativeStatus.EXPLORING || 
       initiative.status === InitiativeStatus.RESEARCHING || 
       initiative.status === InitiativeStatus.PLANNING) && !initiative.processId) {
    warnings.push('Active initiative without process ID');
  }
  
  if (initiative.currentPhase === InitiativePhase.QUESTIONS && (!initiative.questions || initiative.questions.length === 0)) {
    warnings.push('Initiative in questions phase but no questions generated');
  }
  
  if (initiative.currentPhase === InitiativePhase.READY && (!initiative.taskSteps || initiative.taskSteps.length === 0)) {
    warnings.push('Initiative marked as ready but no task steps generated');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Phase-specific Validation
export function validatePhaseTransition(
  currentPhase: InitiativePhase,
  nextPhase: InitiativePhase,
  initiative: Initiative
): ValidationError | null {
  const phaseOrder = [
    InitiativePhase.EXPLORATION,
    InitiativePhase.QUESTIONS,
    InitiativePhase.RESEARCH_PREP,
    InitiativePhase.RESEARCH_REVIEW,
    InitiativePhase.TASK_GENERATION,
    InitiativePhase.READY
  ];
  
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const nextIndex = phaseOrder.indexOf(nextPhase);
  
  if (nextIndex !== currentIndex + 1) {
    return new ValidationError('phase', nextPhase, `invalid transition from ${currentPhase} to ${nextPhase}`);
  }
  
  // Phase-specific requirements
  switch (currentPhase) {
    case InitiativePhase.EXPLORATION:
      if (!initiative.questions || initiative.questions.length === 0) {
        return new ValidationError('questions', initiative.questions, 'must be generated before moving to questions phase');
      }
      break;
      
    case InitiativePhase.QUESTIONS:
      const unanswered = initiative.questions?.filter(q => !initiative.userAnswers?.[q.id]) || [];
      if (unanswered.length > 0) {
        return new ValidationError('questions', unanswered, `${unanswered.length} questions must be answered before proceeding`);
      }
      break;
      
    case InitiativePhase.RESEARCH_PREP:
      if (!initiative.researchNeeds) {
        return new ValidationError('researchNeeds', initiative.researchNeeds, 'must be generated before research review');
      }
      break;
      
    case InitiativePhase.RESEARCH_REVIEW:
      if (!initiative.researchResults) {
        return new ValidationError('researchResults', initiative.researchResults, 'must be provided before task generation');
      }
      break;
      
    case InitiativePhase.TASK_GENERATION:
      if (!initiative.taskSteps || initiative.taskSteps.length === 0) {
        return new ValidationError('taskSteps', initiative.taskSteps, 'must be generated before marking as ready');
      }
      break;
  }
  
  return null;
}

// Pre-flight Checks
export function performPreflightChecks(initiative: Initiative, phase: InitiativePhase): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  
  // General initiative validation
  const initiativeValidation = validateInitiative(initiative);
  errors.push(...initiativeValidation.errors);
  warnings.push(...initiativeValidation.warnings);
  
  // Phase-specific checks
  switch (phase) {
    case InitiativePhase.EXPLORATION:
      // Check objective quality
      if (initiative.objective.split(' ').length < 3) {
        warnings.push('Objective seems too brief, consider providing more detail');
      }
      break;
      
    case InitiativePhase.QUESTIONS:
      // Check if ready for questions
      if (!initiative.plan) {
        errors.push(new ValidationError('plan', initiative.plan, 'must exist before answering questions'));
      }
      break;
      
    case InitiativePhase.RESEARCH_PREP:
      // Check answers completeness
      const answeredCount = Object.keys(initiative.userAnswers || {}).length;
      const questionCount = initiative.questions?.length || 0;
      if (answeredCount < questionCount) {
        warnings.push(`Only ${answeredCount}/${questionCount} questions answered`);
      }
      break;
      
    case InitiativePhase.RESEARCH_REVIEW:
      // Check research needs
      if (!initiative.researchNeeds || initiative.researchNeeds.trim().length === 0) {
        warnings.push('No research needs specified, research phase may be unnecessary');
      }
      break;
      
    case InitiativePhase.TASK_GENERATION:
      // Check research quality
      if (initiative.researchResults && initiative.researchResults.length < 100) {
        warnings.push('Research content seems brief, may affect task generation quality');
      }
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Validation Report Generation
export interface ValidationReport {
  timestamp: Date;
  initiativeId: string;
  phase: InitiativePhase;
  validation: ValidationResult;
  recommendations: string[];
}

// Helper function to be exported
export function validateStringLength(
  value: string,
  field: string,
  minLength: number,
  maxLength: number
): ValidationError | null {
  if (!value || typeof value !== 'string') {
    return new ValidationError(field, value, 'must be a non-empty string');
  }
  if (value.length < minLength) {
    return new ValidationError(field, value, `must be at least ${minLength} characters`, `current: ${value.length}`);
  }
  if (value.length > maxLength) {
    return new ValidationError(field, value, `must be at most ${maxLength} characters`, `current: ${value.length}`);
  }
  return null;
}

export function generateValidationReport(
  initiative: Initiative,
  validation: ValidationResult
): ValidationReport {
  const recommendations: string[] = [];
  
  // Generate recommendations based on errors and warnings
  validation.errors.forEach(error => {
    if (error.field.includes('objective') && error.constraint.includes('length')) {
      recommendations.push('Consider refining the objective to be more specific and actionable');
    }
    if (error.field.includes('questions') && error.constraint.includes('empty')) {
      recommendations.push('Ensure questions are generated during exploration phase');
    }
    if (error.field.includes('tasks') && error.constraint.includes('steps')) {
      recommendations.push('Break down complex tasks into smaller, manageable steps');
    }
  });
  
  validation.warnings.forEach(warning => {
    if (warning.includes('process ID')) {
      recommendations.push('Check if Claude Code process needs to be restarted');
    }
    if (warning.includes('brief')) {
      recommendations.push('Provide more detailed information for better results');
    }
  });
  
  return {
    timestamp: new Date(),
    initiativeId: initiative.id,
    phase: initiative.currentPhase,
    validation,
    recommendations
  };
}

// Export validation limits for external use
export { VALIDATION_LIMITS };