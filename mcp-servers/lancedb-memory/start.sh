#!/bin/bash
# Load OpenAI API key from gateway .env
export OPENAI_API_KEY=$(grep '^OPENAI_API_KEY=' /Users/sergio/sentientsergio/claire/gateway/.env.prod | cut -d= -f2)
exec node /Users/sergio/sentientsergio/claire/mcp-servers/lancedb-memory/dist/index.js
