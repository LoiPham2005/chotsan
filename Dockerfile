# Alpine dùng được kể từ khi lên Prisma 7.
#
# Trước đây phải dùng Debian slim vì Prisma 6 nạp query engine viết bằng Rust,
# và bản dựng sẵn cho musl hay thiếu/lệch — phải khai báo thêm binaryTargets mà
# vẫn gặp lỗi lúc chạy. Prisma 7 bỏ hẳn engine đó, kết nối qua driver adapter
# thuần Node, nên ràng buộc glibc biến mất.
#
# Đổi base: 349MB → 135MB, áp dụng cho MỌI stage.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — cài dependency. Tách riêng để layer cache chỉ vỡ khi lockfile đổi.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# prisma.config.ts là bắt buộc từ Prisma 7: `postinstall` chạy `prisma generate`,
# mà lệnh đó nạp file config này để biết schema nằm ở đâu.
COPY prisma.config.ts ./
COPY prisma ./prisma/
# Config đọc DATABASE_URL ngay lúc nạp. `generate` không hề kết nối database,
# nhưng vẫn cần biến tồn tại — nên đặt giá trị giả CHỈ cho bước build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# Cố tình KHÔNG dùng `--mount=type=cache`: nó bắt buộc phải có BuildKit, mà
# BuildKit lại cần plugin buildx — không phải máy nào cũng có (Colima chẳng
# hạn). Layer cache theo package.json + lockfile đã đủ nhanh cho hầu hết thay đổi.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — build Next.js
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Lúc build không có secret thật, và cũng không cần: không dòng code nào đọc
# giá trị env ở thời điểm này. Bỏ qua validation để build không đòi .env.
ENV SKIP_ENV_VALIDATION=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm db:generate && pnpm build && pnpm realtime:build && pnpm worker:build
# Danh sách gói mà bundle realtime/worker THẬT SỰ require (đọc từ metafile của
# esbuild), phiên bản chính xác đang cài + Prisma Client đã generate — xem
# deploy/runtime-package.mjs.
RUN mkdir -p /runtime/realtime /runtime/worker \
 && node deploy/runtime-package.mjs manifest realtime/dist/meta.json /runtime/realtime \
 && node deploy/runtime-package.mjs manifest worker/dist/meta.json /runtime/worker

# ---------------------------------------------------------------------------
# migrator — image một-lần-chạy để apply migration trước khi web khởi động.
# Image runtime không có Prisma CLI nên cần stage riêng.
# ---------------------------------------------------------------------------
FROM base AS migrator
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Cố tình KHÔNG chép node_modules từ stage deps: bộ đó chứa cả next,
# typescript, vitest, sharp... — hơn 1.5GB cho một image chỉ chạy đúng một câu
# lệnh. `migrate deploy` chỉ cần Prisma CLI và dotenv (prisma.config.ts import).
#
# package.json của dự án được đặt ở /tmp chứ KHÔNG phải /app, vì
# `npm install <pkg>` cài luôn mọi dependency khai báo trong package.json ở
# thư mục hiện tại — chỉ cần nó nằm cạnh là cả cây next/eslint/vite chui vào
# image. `npm init -y` tạo một package.json rỗng để npm không có gì để kéo theo.
COPY package.json /tmp/app-package.json
RUN npm init -y > /dev/null \
 && npm install --no-save --loglevel=error \
      "prisma@$(node -p "require('/tmp/app-package.json').devDependencies.prisma")" \
      "dotenv@$(node -p "require('/tmp/app-package.json').devDependencies.dotenv")" \
 && npm cache clean --force \
 && rm /tmp/app-package.json

# Cố tình KHÔNG kế thừa DATABASE_URL giả của stage deps: stage này chạy thật,
# nên thiếu biến phải báo lỗi ngay chứ không được âm thầm trỏ vào localhost.
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# realtime-deps / worker-deps — node_modules TỐI THIỂU cho hai tiến trình phụ.
#
# Bundle esbuild dùng `--packages=external`: gói npm vẫn được `require` lúc
# chạy. Image từng chỉ chép `dist/` → container chết ngay với
# `Cannot find module 'socket.io'`/`'bullmq'` mà CI vẫn xanh (CI chỉ build `runner`).
#
# Không chép nguyên node_modules: bản đủ ~1,5GB, bản `--prod` ~760MB (next,
# sharp, Prisma CLI…). Chỉ cài đúng gói bundle cần (worker ~110MB vì Prisma
# Client, realtime ~27MB):
#
#   - lockfile GỐC đi kèm → pnpm giữ nguyên phiên bản đã khoá;
#   - `auto-install-peers=false` → không kéo peer TUỲ CHỌN chỉ dùng lúc dev
#     (Prisma CLI, typescript, react là peer của @prisma/client);
#   - `--ignore-scripts` → không build gì, không cần Prisma CLI: client đã
#     generate ở `builder` được chép sang;
#   - `finalize` từ chối phiên bản không có trong lockfile gốc và `require` thử
#     từng gói — thiếu gói thì BUILD đỏ, không đợi container chết.
# ---------------------------------------------------------------------------
FROM base AS realtime-deps
WORKDIR /runtime
COPY --from=builder /runtime/realtime ./
COPY pnpm-lock.yaml ./
COPY pnpm-lock.yaml /tmp/root-lock.yaml
COPY deploy/runtime-package.mjs /tmp/runtime-package.mjs
RUN pnpm install --prod --no-frozen-lockfile --ignore-scripts --config.auto-install-peers=false \
 && node /tmp/runtime-package.mjs finalize /runtime /tmp/root-lock.yaml

FROM base AS worker-deps
WORKDIR /runtime
COPY --from=builder /runtime/worker ./
COPY pnpm-lock.yaml ./
COPY pnpm-lock.yaml /tmp/root-lock.yaml
COPY deploy/runtime-package.mjs /tmp/runtime-package.mjs
RUN pnpm install --prod --no-frozen-lockfile --ignore-scripts --config.auto-install-peers=false \
 && node /tmp/runtime-package.mjs finalize /runtime /tmp/root-lock.yaml

# ---------------------------------------------------------------------------
# realtime — máy chủ WebSocket, tiến trình RIÊNG với web.
#
# Tách vì App Router không giữ được kết nối lâu dài, và vì deploy web không
# được phép làm rớt socket đang mở.
# ---------------------------------------------------------------------------
FROM base AS realtime
ENV NODE_ENV=production \
    REALTIME_PORT=3002 \
    # Mặc định của tiến trình là loopback; trong container phải nghe mọi card
    # mạng vì cổng compose công bố đi vào IP của container, không vào loopback.
    # Cửa ra ngoài vẫn chỉ là `127.0.0.1:` ở `ports:` của compose.
    HOST=0.0.0.0
RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S -G nodejs nextjs
# node_modules thuộc root, user chạy app chỉ đọc: một lỗ RCE không sửa được thư viện.
COPY --from=realtime-deps /runtime/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/realtime/dist/server.cjs ./realtime/dist/server.cjs
USER nextjs
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "realtime/dist/server.cjs"]

# ---------------------------------------------------------------------------
# worker — chạy job nền, TIẾN TRÌNH RIÊNG với web.
#
# Tách vì ba lý do (chi tiết trong worker/worker.ts): deploy web không được
# giết job đang chạy, job nặng không được làm chậm request, và hai bên cần
# scale theo hai con số khác nhau.
#
# `/health` nghe loopback (mặc định của `HOST`): HEALTHCHECK chạy TRONG
# container nên vẫn gọi được, còn số job trong hàng đợi không lộ ra mạng.
# ---------------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=3003
RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S -G nodejs nextjs
COPY --from=worker-deps /runtime/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/worker/dist/worker.cjs ./worker/dist/worker.cjs
USER nextjs
EXPOSE 3003
# `/health` trả 503 khi không đếm được job — tức là mất kết nối Redis. Không có
# nó, một worker treo vẫn được coi là khoẻ vì tiến trình còn tồn tại.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "worker/dist/worker.cjs"]

# ---------------------------------------------------------------------------
# runner — image production, chỉ chứa output standalone
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    # server.js của standalone mặc định bind vào localhost. Trong container
    # điều đó nghĩa là không nhận được request nào từ bên ngoài.
    HOSTNAME=0.0.0.0

# Cú pháp busybox của Alpine, không phải groupadd/useradd của Debian.
RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Không chạy bằng root: một lỗ RCE trong app không kéo theo quyền root container.
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
