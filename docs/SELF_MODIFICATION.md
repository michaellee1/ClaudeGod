# Self-Modification Guide

This guide explains how to use Claude Task Manager to modify its own codebase.

## How It Works

When you create a task that modifies the Claude Task Manager itself:

1. A new git worktree is created in `/tmp/claude-god-worktrees/`
2. The Claude agents work in this isolated worktree
3. Changes don't affect the running instance
4. After task completion, you can merge changes back to the main branch

## Steps for Self-Modification

### 1. Create a Self-Modification Task

```bash
# In the UI, set the repo path to the Claude Task Manager directory
# For example: /Users/username/Code/claude-god
```

You'll see a warning that you're about to modify the tool itself. Click submit again to proceed.

### 2. Monitor the Task

The task will show a "Self-Modification Mode" banner indicating:
- Changes are being made in a temporary worktree
- The location of the worktree
- Changes won't affect the running instance

### 3. Review Changes

Before committing, you can manually review changes in the worktree:

```bash
cd /tmp/claude-god-worktrees/task-<id>
git diff
```

### 4. Commit the Changes

Click "Commit Code" in the UI when satisfied with the changes.

### 5. Merge Back to Main Branch

After committing, use the provided script:

```bash
./scripts/merge-self-modifications.sh task-<id>
```

This will:
- Show you what will be merged
- Ask for confirmation
- Merge the changes
- Optionally delete the branch

### 6. Restart the Application

After merging, restart Claude Task Manager to apply the changes:

```bash
# Stop the current instance (Ctrl+C)
# Start it again
npm run dev
```

## Important Notes

- **Isolation**: Changes are made in an isolated worktree, not the running codebase
- **Dependencies**: The worktree symlinks to the main `node_modules` for faster operation
- **Branch Names**: Task branches are named `task-<random-id>`
- **Conflicts**: If merge conflicts occur, resolve them manually
- **Testing**: Test changes in the worktree before committing
- **Interruptions**: Tasks may show as "interrupted" if the server restarts during execution

## Best Practices

1. **Small Changes**: Make focused, small modifications
2. **Test First**: Ask Claude to test the changes before committing
3. **Review Diffs**: Always review the git diff before committing
4. **Backup**: Keep backups of important configurations
5. **One at a Time**: Avoid multiple self-modification tasks simultaneously

## Troubleshooting

### Tasks Getting Interrupted

Self-modification tasks may be interrupted if:
- The Next.js development server restarts
- File changes trigger hot reloading
- The claude CLI process exits unexpectedly

To minimize interruptions:
1. **Use Production Mode**: Run `npm run build && npm start` instead of `npm run dev`
2. **Monitor Logs**: Watch the server console for restart messages
3. **Quick Tasks**: Break large modifications into smaller tasks
4. **Check Task Outputs**: Interrupted tasks still save their outputs, review them to see progress

### Changes Not Taking Effect

- Ensure you've restarted the application after merging
- Check that the merge was successful with `git log`

### Worktree Issues

- Orphaned worktrees can be cleaned with: `git worktree prune`
- List all worktrees: `git worktree list`

### Permission Issues

- Ensure the temp directory is writable
- Check git permissions in the repository

## Example Self-Modification Prompts

- "Add a new feature to export task history as JSON"
- "Improve the error handling in the process manager"
- "Add dark mode support to the UI"
- "Optimize the task completion detection algorithm"