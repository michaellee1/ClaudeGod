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

Save your findings to {{outputDir}}/exploration.md with the following structure:

```markdown
# Exploration Results

## Context
Brief summary of relevant codebase understanding

## Intermediate Plan
High-level approach and work breakdown

## Questions
1. First clarifying question?
2. Second clarifying question?
3. Third clarifying question?
...
```

Make sure each question:
- Ends with a question mark (?)
- Is numbered (1., 2., 3., etc.)
- Focuses on clarifying design decisions or approach
- Helps refine the implementation plan

Generate 5-10 focused questions.`;

export const REFINEMENT_PROMPT = `# Initiative Research Preparation Phase

You are preparing research tasks for an initiative with the following objective:
{{objective}}

## Context

The user has answered clarifying questions from the exploration phase. You can find the previous phase files in {{outputDir}}:
- questions.json - The questions that were asked
- answers.json - The user's answers to those questions

**User Answers**:
{{answers}}

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

Save your research tasks to {{outputDir}}/research-needs.md with:

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

All previous phase outputs are available in {{outputDir}}:
- questions.json - The questions generated during exploration
- answers.json - User's answers to those questions  
- research-needs.md - The research needs identified
- research.md - The research findings provided by the user

**Research Findings**:
{{research}}

## Your Task

Create a detailed, step-by-step implementation plan broken down into discrete tasks.

## Task Guidelines

Each task should:
- Be atomic and focused (completable in 15-30 minutes)
- Have clear, specific objectives
- Include concrete deliverables
- Follow a logical sequence with proper dependencies

## Output Format

Generate a JSON file with the following structure and save it to {{outputDir}}/tasks.json:

\`\`\`json
{
  "globalContext": "Overall context and approach for all tasks in this initiative",
  "steps": [
    {
      "id": "step-1",
      "name": "Step Name",
      "description": "What this step accomplishes",
      "order": 1,
      "tasks": [
        {
          "id": "task-1-1",
          "title": "Specific task title",
          "description": "Detailed description of what this task accomplishes and how",
          "priority": "high|medium|low",
          "estimatedEffort": "15-30 minutes",
          "dependencies": ["task-id-if-any"]
        }
      ]
    }
  ]
}
\`\`\`

## Important Notes

- Output ONLY the JSON, no markdown wrapper or explanation
- Group related tasks into logical steps
- Each step should have 3-8 tasks
- Total tasks across all steps should not exceed 30
- Ensure tasks can be executed independently when possible
- The globalContext should provide overall guidance for all tasks`;

export const PROMPTS = {
  exploration: EXPLORATION_PROMPT,
  refinement: REFINEMENT_PROMPT,
  planning: PLANNING_PROMPT
} as const;