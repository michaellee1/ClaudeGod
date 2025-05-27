# ClaudeGod

![ClaudeGod](./assets/claudegod.png)

**Run Multiple Autonomous Claude Tasks Locally**

Spin off multiple Claude agents to work on different coding tasks simultaneously, each in their own isolated environment.

## What is ClaudeGod?

ClaudeGod is a local task management system that lets you run multiple Claude AI coding agents in parallel. Each task runs in its own isolated git worktree, allowing you to have Claude work on multiple features, bug fixes, or experiments simultaneously without them interfering with each other.

## Key Features

### Parallel Task Execution
- **Multiple Concurrent Tasks**: Run several Claude agents at once, each working on different parts of your codebase
- **Isolated Environments**: Each task operates in its own git worktree, preventing conflicts
- **Independent Progress**: Tasks run autonomously without blocking each other

### Local Development Focus
- **Everything Runs Locally**: No cloud dependencies - all tasks execute on your machine
- **Full Control**: You decide when to merge changes from each task
- **Git Worktree Integration**: Leverages git's built-in worktree feature for safe isolation

### Task Management Interface
- **Web Dashboard**: Monitor all active tasks from a single interface
- **Real-Time Updates**: See live output from each Claude agent
- **Task History**: Track what each agent is doing and has done

## Quick Start

### Prerequisites
- Node.js 18+ 
- Git repository
- Claude AI access (via API key)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/claude-god.git
cd claude-god

# Install dependencies
npm install

# Start the local server
npm run dev
```

### Running Multiple Tasks

1. Open `http://localhost:3000`
2. Start your first task:
   - Repository: `/path/to/your/project`
   - Task: `"Implement user authentication"`
3. While that's running, start another:
   - Same repository
   - Task: `"Add API rate limiting"`
4. Start a third task:
   - Task: `"Write unit tests for the payment module"`

All three tasks run simultaneously in separate worktrees!

## How It Works

### Task Isolation

When you create a task:
1. ClaudeGod creates a new git worktree in `/tmp/claude-god-worktrees/`
2. Launches a Claude agent in that isolated environment
3. The agent works independently without affecting other tasks or your main branch

### Example Workflow

```
Main Repository: /Users/you/myproject
├── Task 1: /tmp/claude-god-worktrees/task-abc123 (working on auth)
├── Task 2: /tmp/claude-god-worktrees/task-def456 (working on API)
└── Task 3: /tmp/claude-god-worktrees/task-ghi789 (writing tests)
```

Each task has its own:
- Git branch
- Working directory
- Claude agent process
- Progress tracking

### Dual-Agent Architecture

Each task actually runs two Claude agents:
1. **Editor Agent**: Implements the requested changes
2. **Reviewer Agent**: Reviews and refines the implementation

## Use Cases

### Parallel Development
```
Task 1: "Convert authentication from sessions to JWT"
Task 2: "Add pagination to all API endpoints"
Task 3: "Migrate database from MySQL to PostgreSQL"
(All running simultaneously)
```

### Experimentation
```
Task 1: "Try implementing this feature with React"
Task 2: "Try implementing the same feature with Vue"
(Compare different approaches side-by-side)
```

### Large Refactoring
```
Task 1: "Refactor the user module"
Task 2: "Refactor the payment module"
Task 3: "Refactor the notification system"
(Divide and conquer large codebases)
```

## Managing Results

After tasks complete:
- Review changes in each worktree
- Use the **View Diff** button to see all modifications compared to the main branch
- Cherry-pick the best solutions
- Merge approved changes back to main
- Discard experiments that didn't work out

### Viewing Task Differences

Each task page includes a **View Diff** button that allows you to:
- See all file changes made by the task
- Compare modifications against the main branch
- Review changes with syntax highlighting
- Understand the full scope of changes before merging

This helps you make informed decisions about which changes to merge back to your main branch.

## Self-Modification

ClaudeGod can even improve itself - just point it at its own directory:

```bash
# Task: "Add a feature to export task history"
# ClaudeGod creates a worktree of itself and adds the feature
```

See [SELF_MODIFICATION.md](docs/SELF_MODIFICATION.md) for details.

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Process Management**: Node.js child processes for each agent
- **Version Control**: Git worktrees for task isolation