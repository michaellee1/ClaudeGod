# Automatic Merge Conflict Resolution

Claude God now includes automatic merge conflict resolution using Claude Code. When a merge conflict is detected during task merging, the system will automatically attempt to resolve it.

## How It Works

1. **Conflict Detection**: When merging a task branch to main, if Git detects conflicts, the system intercepts the error.

2. **Automatic Resolution**: Claude Code is invoked with:
   - The original task prompt
   - The full diff of changes made by the task
   - List of conflicted files
   - Context about what the task was trying to achieve

3. **Intelligent Resolution**: Claude Code examines the conflicts and:
   - Preserves the task's intended changes
   - Maintains important updates from main
   - Ensures syntactic correctness
   - Removes all conflict markers

4. **Verification**: After resolution, the system verifies all conflicts are resolved before completing the merge.

## Prerequisites

- Claude Code CLI must be installed and available in your PATH
- Run `which claude` to verify installation

## Configuration

The feature is enabled by default. To disable automatic conflict resolution:

```bash
# Set environment variable
export CLAUDE_CODE_AUTO_RESOLVE_CONFLICTS=false
```

Or use the API endpoint:
```bash
curl -X PUT http://localhost:3001/api/config/merge-settings \
  -H "Content-Type: application/json" \
  -d '{"autoResolveConflicts": false}'
```

## Merge Locking

To prevent conflicts from concurrent merges, the system implements a merge lock:
- Only one merge can proceed at a time
- Other merges are queued and will proceed in order
- The UI shows when a merge is waiting in the queue

## Fallback Behavior

If automatic resolution fails:
1. The merge is aborted cleanly
2. The UI shows the standard merge conflict dialog
3. Users can resolve manually or resubmit the task

## Manual Resolution

If automatic resolution is disabled or fails, you can resolve conflicts manually:

```bash
cd /path/to/repo
git checkout main
git merge task-branch
# Resolve conflicts in your editor
git add .
git commit
```

## Best Practices

1. **Keep main branch clean**: Ensure main has no uncommitted changes before merging
2. **Merge frequently**: Smaller, more frequent merges have fewer conflicts
3. **Review resolutions**: While automatic resolution is intelligent, always review merged code
4. **Use preview**: Test changes with the preview feature before merging

## Troubleshooting

### Claude Code not found
```bash
# Install Claude Code CLI
# Follow instructions at: https://claude.ai/code
```

### Resolution takes too long
The default timeout is 5 minutes. Very complex conflicts may timeout.

### Resolution fails repeatedly
- Check Claude Code is properly configured
- Ensure you have sufficient API credits
- Try manual resolution for complex structural conflicts