# Initiative System Documentation

## Overview

The Initiative System in claude-god helps you decompose larger objectives into well-planned, manageable tasks. It guides you through a multi-phase workflow that ensures thorough planning and clear task definition before implementation begins.

## Table of Contents

1. [What is an Initiative?](#what-is-an-initiative)
2. [Initiative Workflow](#initiative-workflow)
3. [Getting Started](#getting-started)
4. [Phase Details](#phase-details)
5. [Best Practices](#best-practices)
6. [FAQ](#faq)
7. [Troubleshooting](#troubleshooting)
8. [API Documentation](#api-documentation)

## What is an Initiative?

An initiative is a structured workflow tool that helps you:
- Break down complex objectives into smaller, actionable tasks
- Ensure comprehensive planning before implementation
- Gather necessary context and research
- Generate well-defined tasks with clear steps

Unlike direct task creation, initiatives provide a guided process that results in better-planned and more achievable tasks.

## Initiative Workflow

The initiative system follows a six-phase workflow:

### 1. **Exploration Phase**
Claude Code explores your codebase and creates an intermediate plan based on your objective.

### 2. **Questions Phase**
You answer high-level questions about your objective to provide additional context.

### 3. **Research Preparation Phase**
Claude Code refines the plan with your answers and generates research needs.

### 4. **Research Review Phase**
You provide research results (typically from Deep Research or other sources).

### 5. **Task Generation Phase**
Claude Code creates a detailed task breakdown with specific implementation steps.

### 6. **Ready Phase**
Tasks are ready for submission to the task system for implementation.

## Getting Started

### Creating a New Initiative

1. Navigate to the Initiatives page (`/initiatives`)
2. Click "Create Initiative"
3. Enter a clear, specific objective (e.g., "Add user authentication with OAuth2")
4. Submit to start the exploration phase

**Tip:** Click the "Help" button on any initiative page for quick access to guidance and best practices.

### Initiative Management

- **View All Initiatives**: Access `/initiatives` to see all your initiatives
- **Initiative Details**: Click on any initiative to view its current phase and progress
- **Phase Navigation**: Each phase must be completed sequentially
- **Manual Actions**: Some phases require your input before proceeding

## Phase Details

### Exploration Phase

**What happens:**
- Claude Code analyzes your codebase
- Creates an intermediate plan
- Generates clarifying questions

**Your role:**
- Wait for exploration to complete
- Review the generated questions

**Tips:**
- Ensure your objective is clear and specific
- The better your initial objective, the more relevant the questions

### Questions Phase

**What happens:**
- Display of exploration questions
- You provide answers to guide planning

**Your role:**
- Answer each question thoughtfully
- Provide specific details and constraints
- Mention any existing patterns or preferences

**Tips:**
- Be specific in your answers
- Include technical constraints
- Mention any dependencies or integrations

### Research Preparation Phase

**What happens:**
- Claude Code processes your answers
- Generates a research needs document
- Identifies areas requiring investigation

**Your role:**
- Review the research needs
- Prepare to conduct research

**Tips:**
- Focus research on unknowns and uncertainties
- Gather examples from similar implementations
- Document API specifications if needed

### Research Review Phase

**What happens:**
- You provide research results
- System prepares for task generation

**Your role:**
- Input research findings
- Include relevant documentation
- Provide code examples if applicable

**Tips:**
- Use Deep Research for comprehensive results
- Include both positive and negative findings
- Document any limitations discovered

### Task Generation Phase

**What happens:**
- Claude Code creates detailed tasks
- Each task includes specific steps
- Dependencies are identified

**Your role:**
- Wait for generation to complete
- Review generated tasks

**Tips:**
- This phase may take several minutes
- Tasks are generated with implementation details
- Each task is self-contained

### Ready Phase

**What happens:**
- Tasks are ready for submission
- You can review and submit tasks

**Your role:**
- Review task breakdown
- Submit tasks to the task system
- Begin implementation

**Tips:**
- Submit tasks in logical order
- Consider dependencies between tasks
- Start with foundational tasks first

## Best Practices

### Writing Clear Objectives

**Do:**
- Be specific about what you want to achieve
- Include the scope of the feature
- Mention any constraints or requirements
- Example: "Add user authentication using JWT tokens with email/password login and password reset functionality"

**Don't:**
- Use vague descriptions
- Include multiple unrelated features
- Skip important context
- Example: "Add auth" (too vague)

### Answering Exploration Questions

**Do:**
- Provide detailed, thoughtful answers
- Include technical specifications
- Mention existing patterns in your codebase
- Reference any external dependencies

**Don't:**
- Give one-word answers
- Skip questions
- Provide contradictory information
- Assume context that isn't explicit

### Conducting Research

**Do:**
- Focus on unknowns and uncertainties
- Gather implementation examples
- Research best practices
- Document security considerations
- Include performance implications

**Don't:**
- Skip research for complex features
- Rely solely on assumptions
- Ignore security or performance
- Provide outdated information

### Reviewing Generated Tasks

**Do:**
- Verify task completeness
- Check for logical dependencies
- Ensure steps are actionable
- Validate against your objective

**Don't:**
- Submit tasks without review
- Ignore missing functionality
- Submit all tasks at once without consideration
- Skip validation of task steps

## FAQ

### General Questions

**Q: How long does an initiative typically take?**
A: The entire process usually takes 15-30 minutes, depending on complexity and research needs.

**Q: Can I have multiple initiatives running simultaneously?**
A: Yes, you can have up to 5 concurrent initiatives, but only 3 Claude Code processes can run at once.

**Q: What happens if an initiative fails?**
A: You can manually restart the phase that failed. The system preserves your progress.

**Q: Can I edit an initiative after creation?**
A: No, initiatives are immutable once created. Create a new initiative for different objectives.

### Technical Questions

**Q: Where is initiative data stored?**
A: Initiative data is stored in `~/.claude-god-data/initiatives/{id}/`

**Q: What thinking mode is used?**
A: Initiatives use the "planning" thinking mode for optimal results.

**Q: Can I export initiative results?**
A: Currently, export functionality is not available. Copy results manually if needed.

**Q: How are tasks submitted?**
A: Tasks are submitted individually through the UI, allowing you to control the order.

### Process Questions

**Q: What if I need to change my objective?**
A: Create a new initiative with the updated objective. Initiatives cannot be modified.

**Q: Can I skip phases?**
A: No, phases must be completed sequentially to ensure proper planning.

**Q: What if research reveals my objective isn't feasible?**
A: You can abandon the initiative and create a new one with a revised objective.

**Q: How detailed should my research be?**
A: Provide enough detail to answer uncertainties and guide implementation decisions.

## Troubleshooting

### Common Issues

#### Initiative Stuck in Processing

**Symptoms:**
- Phase doesn't complete after 10+ minutes
- No error message displayed
- UI shows continuous processing

**Solutions:**
1. Refresh the page
2. Check the console for errors
3. Restart the phase if option available
4. Create a new initiative if problem persists

#### Claude Code Process Failure

**Symptoms:**
- Error message about process failure
- Phase fails to start
- Unexpected termination

**Solutions:**
1. Wait a moment and retry
2. Check if you've hit the 3-process limit
3. Ensure sufficient system resources
4. Report persistent failures

#### Empty or Invalid Results

**Symptoms:**
- No questions generated
- Empty task list
- Incomplete phase outputs

**Solutions:**
1. Verify your objective is clear
2. Check previous phase outputs
3. Ensure all required fields are filled
4. Retry the phase

#### WebSocket Connection Issues

**Symptoms:**
- No real-time updates
- Progress not showing
- Phase appears stuck

**Solutions:**
1. Check network connection
2. Refresh the page
3. Clear browser cache
4. Try a different browser

### Error Messages

#### "Maximum initiatives reached"
You've hit the 5-initiative limit. Complete or delete existing initiatives.

#### "Process limit exceeded"
Only 3 Claude Code processes can run simultaneously. Wait for others to complete.

#### "Phase validation failed"
The current phase output didn't meet requirements. Retry the phase.

#### "Storage write failed"
Check disk space and permissions for `~/.claude-god-data/`

### Getting Help

If you encounter persistent issues:
1. Check the browser console for detailed errors
2. Review server logs for backend issues
3. Ensure you're using a supported browser
4. Report issues with full error details

## API Documentation

### REST API Endpoints

#### Create Initiative
```
POST /api/initiatives
Body: {
  "objective": "string",
  "thinkingMode": "planning" | "architect" | "normal" (optional)
}
Response: {
  "id": "string",
  "objective": "string",
  "phase": "exploration",
  "status": "processing"
}
```

#### Get Initiative
```
GET /api/initiatives/{id}
Response: {
  "id": "string",
  "objective": "string",
  "phase": "string",
  "status": "string",
  "created": "timestamp",
  "updated": "timestamp"
}
```

#### List Initiatives
```
GET /api/initiatives
Response: {
  "initiatives": [Initiative]
}
```

#### Update Initiative Answers
```
POST /api/initiatives/{id}/answers
Body: {
  "answers": "string"
}
Response: {
  "success": true
}
```

#### Provide Research Results
```
POST /api/initiatives/{id}/research
Body: {
  "research": "string"
}
Response: {
  "success": true
}
```

#### Get Initiative Tasks
```
GET /api/initiatives/{id}/tasks
Response: {
  "tasks": [Task]
}
```

#### Validate Initiative
```
POST /api/initiatives/{id}/validation
Response: {
  "valid": boolean,
  "errors": string[]
}
```

### WebSocket Events

#### Connection
```
Connect to: ws://localhost:3001/ws
```

#### Initiative Updates
```javascript
// Incoming events
{
  "type": "initiative-update",
  "id": "initiative-id",
  "phase": "current-phase",
  "status": "processing" | "completed" | "failed"
}

{
  "type": "initiative-output",
  "id": "initiative-id",
  "output": "Claude Code output text"
}

{
  "type": "initiative-error",
  "id": "initiative-id",
  "error": "Error message"
}
```

### Data Structures

#### Initiative Object
```typescript
interface Initiative {
  id: string;
  objective: string;
  phase: 'exploration' | 'questions' | 'research_prep' | 
         'research_review' | 'task_generation' | 'ready';
  status: 'idle' | 'processing' | 'completed' | 'failed';
  created: number;
  updated: number;
  processId?: string;
  thinkingMode: 'planning' | 'architect' | 'normal';
}
```

#### Task Object
```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  steps: string[];
  dependencies: string[];
  priority: 'high' | 'medium' | 'low';
}
```

### Storage Format

Initiatives are stored as JSON files:
- Base directory: `~/.claude-god-data/initiatives/{id}/`
- State file: `state.json`
- Phase outputs: `{phase}.md`
- Task file: `tasks.json`

### Integration Guide

#### Using with Task System
```javascript
// Submit task from initiative
const task = initiative.tasks[0];
await submitTask({
  objective: task.title,
  description: task.description,
  steps: task.steps
});
```

#### Monitoring Progress
```javascript
// WebSocket connection for real-time updates
const ws = new WebSocket('ws://localhost:3001/ws');
ws.on('message', (data) => {
  const event = JSON.parse(data);
  if (event.type === 'initiative-update') {
    updateUI(event);
  }
});
```

#### Error Handling
```javascript
try {
  const response = await fetch('/api/initiatives', {
    method: 'POST',
    body: JSON.stringify({ objective })
  });
  if (!response.ok) {
    handleError(await response.text());
  }
} catch (error) {
  console.error('Initiative creation failed:', error);
}
```