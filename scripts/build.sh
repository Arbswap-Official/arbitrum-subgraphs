#!/bin/sh

if [ -z "$1" ]; then
  echo "Path not set. Usage: ./build.sh PATH"
  exit 1
fi

yarn envsub $1/subgraph.yaml $1/subgraph.temp.yaml

mv ./subgraphs/common/envVars.ts ./subgraphs/common/envVars.ts.backup
yarn envsub ./subgraphs/common/envVars.ts.backup ./subgraphs/common/envVars.ts

yarn graph build \
    $1/subgraph.temp.yaml

mv ./subgraphs/common/envVars.ts.backup ./subgraphs/common/envVars.ts
