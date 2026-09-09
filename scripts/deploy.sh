#!/usr/bin/env bash
# ==============================================================================
# Despliegue automatizado de Talent2flow-Admin (Paperclip) a GCP (paperclip-vm)
#
# REQUISITO ÚNICO, UNA SOLA VEZ EN LA VIDA DE LA VM (no lo hace este script):
#   - El secreto 'better-auth-secret' debe existir en Secret Manager:
#       gcloud secrets create better-auth-secret --data-file=- <<< "$(openssl rand -base64 48)"
#   - El plugin orchestrator-webhook debe estar instalado al menos una vez en
#     /opt/paperclip/plugins/orchestrator-webhook (dist/ compilado + registro
#     en BD vía 'plugin install --local'). Ver scripts/reinstall-plugin.sh.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
IMAGE="us-east1-docker.pkg.dev/csa-talent2flow-dev/talent2flow/paperclip"
VM_NAME="paperclip-vm"
ZONE="us-east1-b"
HEALTH_URL="https://dev.admin.talent.2flow.app/api/health"
PLUGIN_VOLUME="/opt/paperclip/plugins/orchestrator-webhook"

run_container() {
  local image_tag="$1"
  gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap --command="
    set -e
    docker pull $IMAGE:$image_tag

    docker stop paperclip 2>/dev/null || true
    docker rm paperclip 2>/dev/null || true

    DB_PASSWORD=\$(gcloud secrets versions access latest --secret=paperclip-db-url | sed -n 's#.*://[^:]*:\([^@]*\)@.*#\1#p')
    BETTER_AUTH_SECRET=\$(gcloud secrets versions access latest --secret=better-auth-secret)
    PAPERCLIP_API_KEY=\$(gcloud secrets versions access latest --secret=paperclip-api-key)
    GEMINI_API_KEY=\$(gcloud secrets versions access latest --secret=gemini-api-key)

    for var_name in DB_PASSWORD BETTER_AUTH_SECRET PAPERCLIP_API_KEY GEMINI_API_KEY; do
      if [ -z \"\${!var_name}\" ]; then
        echo \"ERROR: \$var_name vino vacío al leerlo de Secret Manager, abortando\" >&2
        exit 1
      fi
    done

    docker run -d --name paperclip --network host --restart always \
      -v /opt/paperclip/data:/paperclip \
      -v $PLUGIN_VOLUME:/tmp/orchestrator-webhook \
      -e NODE_ENV=production \
      -e PORT=3100 \
      -e HOST=127.0.0.1 \
      -e SERVE_UI=true \
      -e DATABASE_URL=\"postgresql://paperclip:\$DB_PASSWORD@127.0.0.1:5432/paperclip\" \
      -e PAPERCLIP_DEPLOYMENT_MODE=authenticated \
      -e PAPERCLIP_DEPLOYMENT_EXPOSURE=public \
      -e PAPERCLIP_PUBLIC_URL=https://dev.admin.talent.2flow.app \
      -e PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://dev.admin.talent.2flow.app \
      -e PAPERCLIP_AUTH_BASE_URL_MODE=explicit \
      -e BETTER_AUTH_URL=https://dev.admin.talent.2flow.app \
      -e BETTER_AUTH_SECRET=\"\$BETTER_AUTH_SECRET\" \
      -e PAPERCLIP_API_KEY=\"\$PAPERCLIP_API_KEY\" \
      -e GEMINI_API_KEY=\"\$GEMINI_API_KEY\" \
      -e GEMINI_CLI_TRUST_WORKSPACE=true \
      -e PAPERCLIP_INSTANCE_ID=default \
      -e PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
      -e OPENCODE_ALLOW_ALL_MODELS=true \
      $IMAGE:$image_tag
  "
}

echo "=================================================================="
echo " [Talent2flow-Admin] Iniciando despliegue a GCP"
echo " Imagen: $IMAGE:$TAG"
echo " VM:     $VM_NAME ($ZONE)"
echo "=================================================================="

# 1. Build y Push a Artifact Registry vía Cloud Build
echo "==> 1. Compilando y publicando imagen con Cloud Build (DOCKER_BUILDKIT=1)..."
gcloud builds submit --config=cloudbuild.yaml . --substitutions=_TAG="$TAG"

# 2. Guardar versión previa para rollback
echo "==> 2. Obteniendo tag actual en la VM para rollback de seguridad..."
FULL_IMAGE=$(gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap \
  --command="docker inspect paperclip --format='{{.Config.Image}}'" 2>/dev/null || echo "")

PREVIOUS_TAG=""
if [[ -n "$FULL_IMAGE" && "$FULL_IMAGE" == *:* ]]; then
  PREVIOUS_TAG="${FULL_IMAGE##*:}"
  echo "    Tag actual previo: $PREVIOUS_TAG"
else
  echo "    Nota: No se detectó tag previo o contenedor paperclip no existía."
fi

# 3. Preparar volúmenes persistentes (idempotente, no borra nada si ya existe)
echo "==> 3. Verificando volúmenes persistentes en $VM_NAME..."
gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap --command="
  sudo mkdir -p /opt/paperclip/data $PLUGIN_VOLUME
  sudo chown -R 1000:1000 /opt/paperclip/plugins
  sudo chmod -R 755 /opt/paperclip/plugins
"

PLUGIN_FILE_COUNT=$(gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap \
  --command="find $PLUGIN_VOLUME -type f 2>/dev/null | wc -l")
if [[ "$PLUGIN_FILE_COUNT" -eq 0 ]]; then
  echo "⚠️  ADVERTENCIA: $PLUGIN_VOLUME está vacío."
  echo "    Paperclip va a arrancar SIN el plugin orchestrator-webhook."
  echo "    Corre scripts/reinstall-plugin.sh (repo Talent2flow-Plugins) antes o después de este deploy."
fi

# 4. Deploy: swap del contenedor con el tag nuevo
echo "==> 4. Desplegando $IMAGE:$TAG en $VM_NAME..."
run_container "$TAG"

# 5. Verificación de Salud (Health Check)
echo "==> 5. Ejecutando health check..."
HEALTHY=false
for i in {1..8}; do
  sleep 5
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  echo "    Esperando respuesta saludable de Paperclip ($i/8)..."
done

if [[ "$HEALTHY" == "true" ]]; then
  echo "✅ Despliegue de Paperclip completado con éxito ($IMAGE:$TAG)."
else
  echo "❌ Error: El servicio no respondió saludablemente en $HEALTH_URL."
  if [[ -n "$PREVIOUS_TAG" ]]; then
    echo "⚠️ Ejecutando rollback automático al tag anterior: $PREVIOUS_TAG..."
    run_container "$PREVIOUS_TAG"
    echo "Rollback completado a $IMAGE:$PREVIOUS_TAG. Verifica manualmente antes de reintentar el deploy."
  else
    echo "⚠️ No hay tag previo conocido — no se puede hacer rollback automático. Revisa manualmente."
  fi
  exit 1
fi