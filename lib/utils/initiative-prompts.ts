// Embedded prompts for initiative phases
// This approach ensures prompts work correctly in Next.js server context

export const EXPLORATION_PROMPT = `# Initiative Exploration Phase

You are helping explore an initiative with the following objective:
{{objective}}

## Your Task

1. **Explore the codebase** to understand:
   - Look for CLAUDE.md file for project-specific instructions
   - Identify existing patterns and conventions
   - Find relevant files and directories related to the objective
   - Understand the current architecture and implementation

2. **Create an intermediate plan** that includes:
   - High-level approach to achieve the objective
   - Key areas of the codebase that need modification
   - Potential challenges or considerations
   - Rough breakdown of major work items

3. **Generate clarifying questions** to help refine the plan:
   - What specific aspects need clarification?
   - What design decisions need user input?
   - What are the tradeoffs to consider?

## Output Format

Save your findings to {{outputDir}}/exploration.md with:

1. **Context**: Brief summary of relevant codebase understanding
2. **Intermediate Plan**: High-level approach and work breakdown
3. **Questions**: Numbered list of clarifying questions (5-10 questions)

Focus on understanding the full scope before detailed planning.`;

export const REFINEMENT_PROMPT = `# Initiative Research Preparation Phase

You are preparing research tasks for an initiative with the following objective:
{{objective}}

## Context

The user has answered clarifying questions. Use these answers along with the exploration findings to create focused research tasks.

**Exploration Summary**:
{{explorationSummary}}

**Questions and Answers**:
{{questionsAndAnswers}}

## Your Task

1. **Synthesize the information** from exploration and answers
2. **Identify specific research needs** based on the refined understanding
3. **Create 3-5 focused research tasks** that will gather necessary information

## Research Task Guidelines

Each research task should:
- Focus on a specific technical aspect or implementation detail
- Be completable in 5-10 minutes
- Produce concrete, actionable findings
- Help inform the detailed implementation plan

## Output Format

Save your research tasks to {{outputDir}}/research-tasks.md with:

\`\`\`markdown
# Research Tasks for Initiative {{id}}

## Objective
{{objective}}

## Research Tasks

### Task 1: [Descriptive Title]
**Goal**: What specific information this research will provide
**Approach**: How to conduct this research (what to look for, where to look)
**Expected Output**: What findings should be documented

### Task 2: [Descriptive Title]
...
\`\`\`

Focus on creating tasks that will provide the information needed for detailed planning.`;

export const PLANNING_PROMPT = `# Initiative Task Generation Phase

You are creating detailed implementation tasks for an initiative with the following objective:
{{objective}}

## Context

Use the exploration findings, user answers, and research results to create a comprehensive implementation plan.

**Exploration Summary**:
{{explorationSummary}}

**Questions and Answers**:
{{questionsAndAnswers}}

**Research Findings**:
{{researchFindings}}

## Your Task

Create a detailed, step-by-step implementation plan broken down into discrete tasks.

## Task Guidelines

Each task should:
- Be atomic and focused (completable in 15-30 minutes)
- Have clear, specific objectives
- Include concrete deliverables
- Follow a logical sequence with proper dependencies

## Output Format

Save your task plan to {{outputDir}}/tasks.md with:

\`\`\`markdown
# Implementation Tasks for Initiative {{id}}

## Objective
{{objective}}

## Implementation Plan

### Phase 1: [Phase Name]

#### Task 1.1: [Specific Task Title]
**Objective**: Clear description of what this task accomplishes
**Files to modify**: List specific files that will be changed
**Changes**: Bullet points of specific changes to make
**Dependencies**: Any tasks that must be completed first
**Validation**: How to verify this task is complete

#### Task 1.2: [Specific Task Title]
...

### Phase 2: [Phase Name]
...
\`\`\`

## Important Notes

- Tasks should be numbered hierarchically (1.1, 1.2, 2.1, etc.)
- Group related tasks into phases
- Ensure tasks can be executed independently when possible
- Include validation steps for each task
- Consider error handling and edge cases`;

export const PROMPTS = {
  exploration: EXPLORATION_PROMPT,
  refinement: REFINEMENT_PROMPT,
  planning: PLANNING_PROMPT
} as const;