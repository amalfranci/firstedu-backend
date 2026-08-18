#!/bin/bash

#
# Setup and Run Blocker Tests
# Comprehensive guide to test the AI generation flow
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CRITICAL BLOCKER TESTS - Setup & Execution Guide         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}\n"

# Check Node.js
echo -e "${BLUE}[1/5] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}\n"

# Check npm
echo -e "${BLUE}[2/5] Checking npm...${NC}"
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "${GREEN}✓ npm ${NPM_VERSION}${NC}\n"

# Install dependencies
echo -e "${BLUE}[3/5] Installing/updating dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo "  Installing npm packages..."
    npm install
else
    echo "  npm packages already installed"
fi
echo -e "${GREEN}✓ Dependencies ready${NC}\n"

# Check environment variables
echo -e "${BLUE}[4/5] Checking environment variables...${NC}"
if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  GEMINI_API_KEY not set${NC}"
    echo "  Set it with: export GEMINI_API_KEY='your-key-here'"
    echo "  Tests will fail without this"
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  OPENAI_API_KEY not set${NC}"
    echo "  Set it with: export OPENAI_API_KEY='your-key-here'"
    echo "  Tests will fail without this"
fi

if [ -n "$GEMINI_API_KEY" ] && [ -n "$OPENAI_API_KEY" ]; then
    echo -e "${GREEN}✓ Environment variables set${NC}\n"
else
    echo -e "${RED}❌ Missing required API keys - tests will fail${NC}"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo ""
fi

# Check backend
echo -e "${BLUE}[5/5] Checking backend connection...${NC}"
TEST_URL="${TEST_API_URL:-http://localhost:3000}"
echo "  Connecting to: $TEST_URL"

if curl -s "$TEST_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is running${NC}\n"
else
    echo -e "${YELLOW}⚠️  Backend not reachable at $TEST_URL${NC}"
    echo ""
    echo -e "${YELLOW}To start backend, in another terminal run:${NC}"
    echo "  npm run start"
    echo ""
    echo -e "${YELLOW}Or use a different URL:${NC}"
    echo "  export TEST_API_URL='http://your-backend:3000'"
    echo ""
    read -p "Backend started? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Cannot proceed without backend${NC}"
        exit 1
    fi
    echo ""
fi

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All prerequisites ready${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}IMPORTANT NOTES:${NC}"
echo "1. Tests make real LLM calls (Gemini + OpenAI)"
echo "2. Each test takes 10-30 minutes"
echo "3. Total runtime: ~90 minutes"
echo "4. Costs: ~$2-5 in LLM credits"
echo "5. Tests will fail if API quotas are exhausted"
echo ""

read -p "Ready to run blocker tests? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted"
    exit 0
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}RUNNING BLOCKER TESTS${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

# Run tests
echo -e "${YELLOW}Starting test runner...${NC}\n"

# Make runner executable
chmod +x run-blockers.sh

# Run with verbose output
export TEST_API_URL="${TEST_API_URL:-http://localhost:3000}"
export JEST_TIMEOUT=900000  # 15 minutes per test

./run-blockers.sh

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Tests completed${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review results above"
echo "2. If all pass ✓ → Ready for Phase 3 (calibration)"
echo "3. If any fail ✗ → See troubleshooting guide:"
echo "   → firstedu-backend/BLOCKER_TEST_GUIDE.md"
echo ""

