# Initiative Planning Phase

You are creating the final implementation plan for an initiative with the following objective:
{{objective}}

## Previous Context

Read all previous outputs from this initiative:
1. `{{outputDir}}/intermediate-plan.md` - Your initial exploration
2. `{{outputDir}}/questions.md` - Your clarifying questions
3. User's answers to your questions (provided during refinement)
4. `{{outputDir}}/research-needs.md` - Your research requirements

### Research Results
{{researchResults}}

## Your Task

Create a detailed task breakdown that:
1. Incorporates all learnings from previous phases
2. Applies research findings to technical decisions
3. Breaks down work into well-defined tasks
4. Organizes tasks into logical steps for implementation

## Task Sizing Guidelines

- **Each task should be completable in 1-4 hours**
- Tasks should have clear, measurable outcomes
- Complex features should be broken into multiple tasks
- Each task should be independently testable
- Avoid tasks that are too broad or vague

## Output Format

Create a JSON file: `{{outputDir}}/tasks.json`

Structure:
```json
{
  "initiative": {
    "id": "{{initiativeId}}",
    "objective": "{{objective}}",
    "totalTasks": 0,
    "steps": []
  },
  "steps": [
    {
      "id": "step-1",
      "name": "Step Name",
      "description": "What this step accomplishes",
      "tasks": [
        {
          "title": "Specific task title",
          "description": "Detailed description of what needs to be done",
          "acceptanceCriteria": [
            "Specific, testable criteria 1",
            "Specific, testable criteria 2"
          ],
          "technicalNotes": "Any important technical context or decisions",
          "estimatedHours": 2
        }
      ]
    }
  ]
}
```

## Step Organization Guidelines
Many of the tasks may depend on previous tasks and/or may have some overlap areas, so we can't just send things off all at once.  Steps are a way to order groups of tasks to solve this.  Previous steps will be merged in before the next step completes.  Tasks in a step should be independent, they will not see code written by other tasks in that step, only code from the step before.

1. **Steps are not**: Steps are NOT logical groupings of tasks. 
2. **Steps purpose**: Create a run order that will not lead to merge conflicts, AND will lead to better performance as future steps will be able to see and reference the code written by the previous step.
3. **Dependencies**: Order steps considering dependencies and merge conflicts.
4. **Testing**: If you want to include testing or other things that are better when referencing the actual code that is there, either include it in the same task (preferred) or in the next step.  If you include it as a separate task in the same step then it not be able to see the code.
5. **Safety**: Err on the side of more steps than less (without too many), when there is likely to be tasks in a step that change the same parts of the same files (merge conflicts)

## Task Description Best Practices

- Start with an action verb (Create, Implement, Add, Update, etc.)
- Be specific about what needs to be built
- Reference specific files or components when known
- Include technical decisions from research
- Mention integration points clearly
- Specify expected outputs or changes

## Example Task Structure

```json
{
  "title": "Implement WebSocket message handler for initiative updates",
  "description": "Create a new WebSocket message handler in server.js that broadcasts initiative state changes to connected clients. Should handle message types: initiative-created, initiative-updated, initiative-phase-changed.",
  "acceptanceCriteria": [
    "New message types added to WebSocket message handler",
    "Broadcasts sent when InitiativeStore updates",
    "Client receives real-time initiative updates",
    "Error handling for invalid message formats"
  ],
  "technicalNotes": "Follow existing WebSocket patterns in server.js. Use the same message structure as task-update messages.",
  "estimatedHours": 2
}
```

## Important Notes

- Ensure all tasks are actionable and concrete
- Include sufficient context for implementation
- Consider the order of implementation carefully
- Don't create overly granular tasks (too many small tasks)
- Don't create overly broad tasks (unclear scope)
- Include testing and documentation tasks
- Ensure JSON is valid and properly formatted
- Total task count should match the actual number of tasks