# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# OVH_WEBUI 单镜像（前端 //go:embed 进 Go 二进制，一个容器一个端口）
#
# 前端和 Go 编译都跑在构建机原生架构上（--platform=$BUILDPLATFORM），
# Go 用自己的交叉编译出目标架构，多架构构建不需要 QEMU 模拟 npm/go。
# CGO_ENABLED=0 走 modernc.org/sqlite 纯 Go 驱动，二进制静态链接。
#
# 本地构建: docker build -t ovh-webui .
# ─────────────────────────────────────────────────────────────────────────────

# ---- 1. 构建前端（vite 默认输出到 /app/dist）----
FROM --platform=$BUILDPLATFORM node:20-alpine AS webbuild
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts tsconfig*.json tailwind.config.ts postcss.config.js components.json ./
COPY public ./public
COPY src ./src
ENV NODE_ENV=production
RUN npm run build

# ---- 2. 构建后端（-tags ui 把 backend/web 嵌进二进制）----
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS gobuild
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# //go:embed all:web 是编译期读的，前端产物必须先就位
COPY --from=webbuild /app/dist ./web

ARG TARGETOS
ARG TARGETARCH
# 版本号注入路径要和 handlers.Version 一致，否则界面和更新检查拿到的是 "dev"
RUN VERSION="$(cat VERSION)" && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -tags ui -trimpath \
      -ldflags "-s -w -X github.com/ovh-webui/server/internal/handlers.Version=${VERSION}" \
      -o /out/ovh-webui .

# ---- 3. 运行时 ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -S ovh && adduser -S -G ovh -h /app ovh

WORKDIR /app
COPY --from=gobuild /out/ovh-webui /app/ovh-webui
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/ovh-webui /app/docker-entrypoint.sh \
    && mkdir -p /data/cache /data/logs \
    && chown -R ovh:ovh /app /data

# OVH_ENV_FILE 指到卷上：没给 OVH_DB_KEY 时自动生成的数据库密钥写在这里，
# 容器重建也不会丢（丢了已存的 OVH 凭据就解不开了）。
# OVH_IN_CONTAINER=1 停用程序内自更新，容器靠拉新镜像更新。
ENV PORT=19998 \
    LISTEN_HOST=0.0.0.0 \
    DATA_DIR=/data \
    GIN_MODE=release \
    ENABLE_API_KEY_AUTH=true \
    TZ=Asia/Shanghai \
    OVH_ENV_FILE=/data/.env \
    OVH_IN_CONTAINER=1

VOLUME ["/data"]
EXPOSE 19998
USER ovh

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["/app/ovh-webui"]
