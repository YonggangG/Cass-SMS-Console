#!/usr/bin/env sh
set -eu
IMAGE="${IMAGE:-ghcr.io/yonggangg/cass-sms-console:latest}"
docker build -t "$IMAGE" .
echo "Built $IMAGE"
