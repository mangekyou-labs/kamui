#!/bin/bash

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping VRF Server${NC}"

# Find all VRF server processes
VRF_PIDS=$(pgrep -f vrf-server)

if [ -z "$VRF_PIDS" ]; then
    echo -e "${RED}No VRF server processes found${NC}"
    exit 0
fi

# Count the number of processes
NUM_PROCESSES=$(echo "$VRF_PIDS" | wc -l)
echo -e "${YELLOW}Found ${NUM_PROCESSES} VRF server processes${NC}"

# Kill each process
for PID in $VRF_PIDS; do
    echo -e "${YELLOW}Killing VRF server process with PID: ${PID}${NC}"
    kill $PID
done

# Verify that all processes have been terminated
sleep 1
VRF_PIDS=$(pgrep -f vrf-server)
if [ -z "$VRF_PIDS" ]; then
    echo -e "${GREEN}All VRF server processes have been terminated${NC}"
else
    echo -e "${RED}Some VRF server processes are still running. Forcing termination...${NC}"
    pkill -9 -f vrf-server
    echo -e "${GREEN}All VRF server processes have been forcefully terminated${NC}"
fi 