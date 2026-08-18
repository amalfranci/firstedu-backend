#!/bin/bash

#
# run-blockers.sh - Run all 4 critical blocker tests
#
# Usage:
#   ./run-blockers.sh
#   ./run-blockers.sh --gap-only
#   ./run-blockers.sh --non-stem-only
#   ./run-blockers.sh --fallback-only
#   ./run-blockers.sh --multiple-only
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Config
TEST_API_URL="${TEST_API_URL:-http://localhost:3000}"
TIMEOUT_MS="${JEST_TIMEOUT:-600000}"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Critical Blocker Test Runner${NC}"
echo -e "${BLUE}================================${NC}\n"

echo "Configuration:"
echo "  API URL:       $TEST_API_URL"
echo "  Timeout:       ${TIMEOUT_MS}ms"
echo "  Test command:  jest --testTimeout=$TIMEOUT_MS"
echo ""

# Check if backend is running
echo "Checking backend connectivity..."
if ! curl -s "$TEST_API_URL/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Backend not reachable at $TEST_API_URL${NC}"
    echo "Please start backend first: npm run start"
    exit 1
fi
echo -e "${GREEN}✓ Backend is running${NC}\n"

# Parse arguments
RUN_ALL=true
RUN_GAP=false
RUN_NON_STEM=false
RUN_FALLBACK=false
RUN_MULTIPLE=false

case "$1" in
    --gap-only)
        RUN_ALL=false
        RUN_GAP=true
        ;;
    --non-stem-only)
        RUN_ALL=false
        RUN_NON_STEM=true
        ;;
    --fallback-only)
        RUN_ALL=false
        RUN_FALLBACK=true
        ;;
    --multiple-only)
        RUN_ALL=false
        RUN_MULTIPLE=true
        ;;
    --help)
        echo "Usage: ./run-blockers.sh [OPTION]"
        echo ""
        echo "Options:"
        echo "  (none)              Run all 4 blocker tests"
        echo "  --gap-only          Run score gap investigation only"
        echo "  --non-stem-only     Run non-STEM path validation only"
        echo "  --fallback-only     Run provider fallback tests only"
        echo "  --multiple-only     Run multiple-correct validation only"
        echo "  --help              Show this help message"
        exit 0
        ;;
esac

# Helper function to run a test
run_test() {
    local test_file=$1
    local test_name=$2
    local description=$3

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Running: $test_name${NC}"
    echo -e "${BLUE}$description${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

    local start_time=$(date +%s)

    if npm test -- "tests/$test_file" --testTimeout=$TIMEOUT_MS; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo -e "\n${GREEN}✓ PASSED${NC} (${duration}s)\n"
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo -e "\n${RED}✗ FAILED${NC} (${duration}s)\n"
        return 1
    fi
}

# Counters
PASSED=0
FAILED=0

# Run tests based on flags
if $RUN_ALL || $RUN_GAP; then
    echo ""
    if run_test "score-gap-investigation.test.js" "Score Gap Investigation" "Compares internal vs OpenAI validation scores"; then
        ((PASSED++))
    else
        ((FAILED++))
    fi
fi

if $RUN_ALL || $RUN_NON_STEM; then
    echo ""
    if run_test "non-stem-path-validation.test.js" "Non-STEM Path Validation" "Tests DILR, VARC, CAT QA text-answer handling"; then
        ((PASSED++))
    else
        ((FAILED++))
    fi
fi

if $RUN_ALL || $RUN_FALLBACK; then
    echo ""
    if run_test "provider-fallback.test.js" "Provider Fallback" "Verifies Gemini → OpenAI fallback logic"; then
        ((PASSED++))
    else
        ((FAILED++))
    fi
fi

if $RUN_ALL || $RUN_MULTIPLE; then
    echo ""
    if run_test "multiple-correct-validation.test.js" "Multiple-Correct Validation" "Ensures exactly 2 correct answers per question"; then
        ((PASSED++))
    else
        ((FAILED++))
    fi
fi

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}FINAL RESULTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All ${PASSED} tests PASSED${NC}"
    echo -e "\n${GREEN}🚀 Ready for production!${NC}\n"
    exit 0
else
    echo -e "${RED}✗ ${FAILED} test(s) FAILED, ${PASSED} passed${NC}"
    echo -e "\n${RED}⚠️  Fix failures before proceeding to production${NC}\n"
    exit 1
fi
