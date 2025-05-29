#!/bin/bash

echo "Testing process ID fix for initiatives..."
echo ""

# Step 1: Create a new initiative
echo "1. Creating new initiative..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/initiatives \
  -H "Content-Type: application/json" \
  -d '{"objective": "Test initiative to verify process ID is properly set during exploration phase"}')

INITIATIVE_ID=$(echo $RESPONSE | jq -r '.id')
if [ "$INITIATIVE_ID" = "null" ]; then
  echo "❌ Failed to create initiative"
  echo "$RESPONSE"
  exit 1
fi

echo "✅ Initiative created: $INITIATIVE_ID"
echo "   Status: $(echo $RESPONSE | jq -r '.status')"
echo "   Phase: $(echo $RESPONSE | jq -r '.phase')"
echo "   Process ID: $(echo $RESPONSE | jq -r '.processId // "NOT SET"')"
echo "   Is Active: $(echo $RESPONSE | jq -r '.isActive')"

# Step 2: Wait for process to start
echo ""
echo "2. Waiting for process to start..."
sleep 2

# Step 3: Fetch the initiative again
echo ""
echo "3. Fetching initiative details..."
DETAILS=$(curl -s http://localhost:3000/api/initiatives/$INITIATIVE_ID)
PROCESS_ID=$(echo $DETAILS | jq -r '.processId // "NOT SET"')
IS_ACTIVE=$(echo $DETAILS | jq -r '.isActive // false')

echo "✅ Initiative fetched:"
echo "   Process ID: $PROCESS_ID"
echo "   Is Active: $IS_ACTIVE"

# Step 4: Check validation
echo ""
echo "4. Checking validation..."
VALIDATION=$(curl -s http://localhost:3000/api/initiatives/$INITIATIVE_ID/validation)
WARNINGS=$(echo $VALIDATION | jq -r '.validation.warnings[]' 2>/dev/null)
WARNING_COUNT=$(echo $VALIDATION | jq -r '.validation.warnings | length')

echo "✅ Validation result:"
echo "   Valid: $(echo $VALIDATION | jq -r '.validation.valid')"
echo "   Warnings: $WARNING_COUNT"
if [ "$WARNING_COUNT" -gt 0 ]; then
  echo "   Warning messages:"
  echo "$VALIDATION" | jq -r '.validation.warnings[]' | while read -r warning; do
    echo "     - $warning"
  done
fi

# Step 5: Summary
echo ""
echo "5. Test Summary:"
PROCESS_ID_WARNINGS=$(echo "$WARNINGS" | grep -c "process ID" || true)

if [ "$PROCESS_ID" != "NOT SET" ] && [ "$PROCESS_ID_WARNINGS" -eq 0 ]; then
  echo "✅ SUCCESS: Process ID is properly set and no validation warnings about missing process ID!"
else
  echo "❌ FAILURE: Process ID issue still exists"
  if [ "$PROCESS_ID" = "NOT SET" ]; then
    echo "   - Process ID is not set on the initiative"
  fi
  if [ "$PROCESS_ID_WARNINGS" -gt 0 ]; then
    echo "   - Validation still reports missing process ID warnings"
  fi
fi