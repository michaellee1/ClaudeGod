#!/bin/bash

echo "Testing initiative output fix..."
echo ""

# Create initiative
echo "1. Creating new initiative..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/initiatives \
  -H "Content-Type: application/json" \
  -d '{"objective": "Test initiative to verify output is working correctly"}')

INITIATIVE_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4)
STATUS=$(echo $RESPONSE | grep -o '"status":"[^"]*' | cut -d'"' -f4)
PHASE=$(echo $RESPONSE | grep -o '"currentPhase":"[^"]*' | cut -d'"' -f4)

echo "✓ Initiative created: $INITIATIVE_ID"
echo "  Status: $STATUS"
echo "  Phase: $PHASE"
echo ""

echo "2. Please check the browser at http://localhost:3000/initiative/$INITIATIVE_ID"
echo "   - You should see the exploration phase starting"
echo "   - Output should appear in real-time"
echo ""
echo "Initiative ID: $INITIATIVE_ID"