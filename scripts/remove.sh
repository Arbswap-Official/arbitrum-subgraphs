#!/bin/sh

yarn graph remove \
    --node ${DEPLOY_URL} \
    --access-token ${ACCESS_TOKEN} \
    ${SUBGRAPH_NAME}
