#!/usr/bin/env bash
set -euo pipefail

# ── Load secrets from .env ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
else
  echo "ERROR: .env file not found. Create one with MCP_API_KEY, GONG_ACCESS_KEY, GONG_ACCESS_KEY_SECRET, GONG_BASE_URL"
  exit 1
fi

# ── Configuration ──────────────────────────────────────────────────────────
RESOURCE_GROUP="doldata-rg"
LOCATION="eastus"
ACR_NAME="doldataacr"
APP_NAME="gong-mcp"
ENVIRONMENT_NAME="doldata-env"
IMAGE_TAG="${ACR_NAME}.azurecr.io/${APP_NAME}:latest"

echo "==> Ensuring Container App Environment exists..."
if ! az containerapp env show -n "$ENVIRONMENT_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az containerapp env create \
    --name "$ENVIRONMENT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION"
fi

echo "==> Ensuring ACR exists..."
if ! az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Basic \
    --admin-enabled true
fi

echo "==> Building and pushing image to ACR..."
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "${APP_NAME}:latest" \
  .

echo "==> Fetching ACR credentials..."
ACR_PASSWORD=$(az acr credential show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query "passwords[0].value" -o tsv)

echo "==> Deploying Container App..."
if az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  # Update existing app with new image, secrets, and keep min-replicas=1
  # so a warm instance is always available (avoids ~10-30s cold-start latency).
  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$IMAGE_TAG" \
    --min-replicas 1 \
    --max-replicas 1 \
    --set-env-vars \
      MCP_API_KEY=secretref:mcp-api-key \
      GONG_ACCESS_KEY=secretref:gong-access-key \
      GONG_ACCESS_KEY_SECRET=secretref:gong-access-key-secret \
      GONG_BASE_URL=secretref:gong-base-url \
    --secrets \
      mcp-api-key="$MCP_API_KEY" \
      gong-access-key="$GONG_ACCESS_KEY" \
      gong-access-key-secret="$GONG_ACCESS_KEY_SECRET" \
      gong-base-url="$GONG_BASE_URL"
else
  # Create new app. min-replicas=1 keeps an instance warm; the server itself
  # emits SSE keepalive comments to defeat Azure's 4-minute ingress idle timeout.
  az containerapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT_NAME" \
    --image "$IMAGE_TAG" \
    --registry-server "${ACR_NAME}.azurecr.io" \
    --registry-username "$ACR_NAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 8080 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --env-vars \
      MCP_API_KEY=secretref:mcp-api-key \
      GONG_ACCESS_KEY=secretref:gong-access-key \
      GONG_ACCESS_KEY_SECRET=secretref:gong-access-key-secret \
      GONG_BASE_URL=secretref:gong-base-url \
    --secrets \
      mcp-api-key="$MCP_API_KEY" \
      gong-access-key="$GONG_ACCESS_KEY" \
      gong-access-key-secret="$GONG_ACCESS_KEY_SECRET" \
      gong-base-url="$GONG_BASE_URL"
fi

FQDN=$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)
echo ""
echo "==> Deployed successfully!"
echo "    MCP Endpoint: https://${FQDN}/mcp"
echo "    Health check: https://${FQDN}/health"
