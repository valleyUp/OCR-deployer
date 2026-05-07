FROM node:lts-alpine AS build-stage

ARG NPM_REGISTRY_URL=https://registry.npmmirror.com

WORKDIR /app

COPY upstream/glm-ocr/apps/frontend/package.json upstream/glm-ocr/apps/frontend/pnpm-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@8 --activate && \
    pnpm config set registry "${NPM_REGISTRY_URL}"
RUN pnpm install --frozen-lockfile

COPY upstream/glm-ocr/apps/frontend/ ./
COPY deploy/overlays/frontend/ ./

RUN pdfjs_dist_dir="$(find node_modules -type d -path '*/pdfjs-dist' | head -n 1)" && \
    if [ -z "${pdfjs_dist_dir}" ]; then echo "pdfjs-dist not found in node_modules" >&2; exit 1; fi && \
    pdfjs_worker="${pdfjs_dist_dir}/build/pdf.worker.min.mjs" && \
    if [ ! -f "${pdfjs_worker}" ]; then pdfjs_worker="${pdfjs_dist_dir}/legacy/build/pdf.worker.min.mjs"; fi && \
    if [ ! -f "${pdfjs_worker}" ]; then echo "pdf.worker.min.mjs not found" >&2; exit 1; fi && \
    mkdir -p public/pdfjs && \
    cp "${pdfjs_worker}" public/pdfjs/pdf.worker.min.mjs && \
    cp -R "${pdfjs_dist_dir}/cmaps" public/pdfjs/ && \
    cp -R "${pdfjs_dist_dir}/standard_fonts" public/pdfjs/ && \
    pnpm build && \
    pnpm store prune && \
    rm -rf node_modules

FROM nginx:stable-alpine AS production-stage

COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY --from=build-stage /app/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD test -f /usr/share/nginx/html/index.html || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
