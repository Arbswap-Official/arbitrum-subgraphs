#!/bin/sh

yarn graph create \
    --node ${DEPLOY_URL} \
    --access-token ${ACCESS_TOKEN} \
    ${SUBGRAPH_NAME}
