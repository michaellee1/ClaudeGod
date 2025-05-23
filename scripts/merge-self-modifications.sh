#!/bin/bash

# Script to merge self-modifications back to the main branch
# Usage: ./scripts/merge-self-modifications.sh <branch-name>

if [ -z "$1" ]; then
    echo "Usage: $0 <branch-name>"
    echo "Example: $0 task-abc123"
    exit 1
fi

BRANCH_NAME=$1
CURRENT_BRANCH=$(git branch --show-current)

echo "Merging self-modifications from branch: $BRANCH_NAME"

# Fetch latest changes
git fetch --all

# Check if branch exists
if ! git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
    echo "Error: Branch $BRANCH_NAME does not exist"
    exit 1
fi

# Show what will be merged
echo "Changes to be merged:"
git log --oneline $CURRENT_BRANCH..$BRANCH_NAME

# Confirm merge
read -p "Do you want to merge these changes? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Merge cancelled"
    exit 0
fi

# Perform the merge
git merge $BRANCH_NAME --no-ff -m "Merge self-modifications from $BRANCH_NAME"

if [ $? -eq 0 ]; then
    echo "Merge successful!"
    echo "You should now restart the Claude Task Manager to apply the changes."
    
    # Optionally delete the branch
    read -p "Delete the branch $BRANCH_NAME? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git branch -d $BRANCH_NAME
        echo "Branch deleted"
    fi
else
    echo "Merge failed. Please resolve conflicts manually."
    exit 1
fi