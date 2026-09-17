.PHONY: help setup install dev build start check e2e lint lint-fix typecheck test test-watch \
        test-coverage format format-check realtime worker \
        db-generate db-migrate-diff db-deploy db-studio db-seed db-seed-prod db-purge check-conflict \
        docker-build docker-up docker-down docker-logs docker-ps \
        docker-deploy docker-size docker-clean \
        vps-deploy vps-logs vps-status vps-files \
        pm2-deploy pm2-start pm2-stop pm2-restart pm2-reload pm2-logs pm2-status pm2-monit

help:
	@echo "========================================================================"
	@echo "                  CHỐTSÂN — BẢNG HƯỚNG DẪN CÁC LỆNH MAKE                "
	@echo "========================================================================"
	@echo "--- BẮT ĐẦU ---"
	@echo "  make setup           - Cài deps + tạo .env + dựng Postgres + migrate + seed (chạy 1 lần)"
	@echo ""
	@echo "--- PHÁT TRIỂN ---"
	@echo "  make install         - Cài đặt dependencies"
	@echo "  make dev             - Chạy dev server (http://localhost:3000)"
	@echo "  make start           - Chạy bản build production"
	@echo "  make realtime        - Chạy máy chủ WebSocket (tiến trình riêng, cổng 3002)"
	@echo "  make worker          - Chạy worker job nền (cần REDIS_URL khi QUEUE_ENABLED=1)"
	@echo "  make build           - Build production"
	@echo ""
	@echo "--- CHẤT LƯỢNG ---"
	@echo "  make check           - Như CI: typecheck + lint + format + test kèm ngưỡng coverage"
	@echo "  make typecheck       - Kiểm tra kiểu TypeScript"
	@echo "  make lint            - ESLint (make lint-fix để tự sửa)"
	@echo "  make test            - Unit test (test-watch / test-coverage)"
	@echo "  make format          - Prettier (format-check để chỉ kiểm tra)"
	@echo "  make e2e             - Playwright trên bản build production (cổng 3100)"
	@echo "  make check-conflict  - Chống trùng chỗ/trùng tiền trên DATABASE THẬT (DATABASE_URL)"
	@echo ""
	@echo "--- DATABASE ---"
	@echo "  make db-migrate-diff - In SQL khác biệt giữa database và schema.prisma (ĐỌC + LỌC DROP)"
	@echo "  make db-deploy       - Áp migration đã có trong prisma/migrations"
	@echo "  make db-generate     - Sinh Prisma Client (xong thì khởi động lại pnpm dev)"
	@echo "  make db-studio       - Mở Prisma Studio"
	@echo "  make db-seed         - Nạp dữ liệu mẫu (chạy lại an toàn)"
	@echo "  make db-seed-prod    - Chỉ tạo quyền, môn và tài khoản admin nền"
	@echo "  make db-purge        - Dọn token, nhật ký, thiết bị đã hết hạn"
	@echo "  ⚠️  KHÔNG có migrate dev / db push / reset: chúng xoá ràng buộc viết tay"
	@echo "     (docs/GOTCHAS.md #11). Quy trình: db-migrate-diff → lọc SQL → db-deploy"
	@echo "     → db-generate → check-conflict."
	@echo ""
	@echo "--- HƯỚNG DẪN DEPLOY ĐẦY ĐỦ: docs/DEPLOY_VPS.md ---"
	@echo ""
	@echo "--- DEPLOY: DOCKER ---"
	@echo "  make docker-build    - Build image"
	@echo "  make docker-up       - Chạy postgres + migrate + web + redis + realtime + worker"
	@echo "  make docker-down     - Dừng và xoá container"
	@echo "  make docker-logs     - Xem log realtime"
	@echo "  make docker-ps       - Trạng thái container"
	@echo "  make docker-deploy   - Deploy trên VPS: build, up, health check, dọn rác"
	@echo "  make docker-size     - Xem dung lượng image và rác build còn sót"
	@echo "  make docker-clean    - Xoá image mồ côi do build lỗi (an toàn)"
	@echo ""
	@echo "--- DEPLOY: PM2 (Process Manager) ---"
	@echo "  make pm2-deploy      - Deploy trên VPS bằng PM2 (pull, deps, migrate, build, reload)"
	@echo "  make pm2-start       - Khởi động service bằng PM2"
	@echo "  make pm2-stop        - Dừng service PM2"
	@echo "  make pm2-restart     - Khởi động lại service PM2"
	@echo "  make pm2-reload      - Zero-downtime reload service PM2"
	@echo "  make pm2-logs        - Xem log PM2 realtime"
	@echo "  make pm2-status      - Xem trạng thái tiến trình PM2"
	@echo "  make pm2-monit       - Mở dashboard giám sát PM2"
	@echo ""
	@echo "--- DEPLOY: VPS TRỰC TIẾP (systemd + Caddy) ---"
	@echo "  make vps-deploy      - Deploy trên máy chủ (pull, migrate, build, restart)"
	@echo "  make vps-logs        - Xem log service qua journalctl"
	@echo "  make vps-status      - Trạng thái systemd service"
	@echo "  make vps-files       - In hướng dẫn cài systemd + Caddy lần đầu"
	@echo "========================================================================"

# Một lệnh duy nhất để có môi trường chạy được từ repo vừa clone, với Postgres
# chạy bằng Docker trên máy. Dùng Neon/Postgres có sẵn thì bỏ qua target này:
# điền DATABASE_URL rồi chạy `pnpm db:deploy && pnpm db:seed`.
#
# `db:deploy` chứ KHÔNG `migrate dev`: migration đã có sẵn trong repo (kèm ràng
# buộc viết tay), `migrate dev` sẽ đòi xoá chúng — docs/GOTCHAS.md #11.
setup:
	pnpm install
	@test -f .env || (cp .env.example .env && echo "→ Đã tạo .env — hãy set SESSION_SECRET: openssl rand -base64 48")
	docker compose up -d postgres
	@echo "→ Đợi Postgres sẵn sàng..."
	@until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	pnpm db:deploy
	pnpm db:seed
	@echo "→ Xong. Chạy 'make dev'."

install:
	pnpm install

dev:
	pnpm dev

start:
	pnpm start

realtime:
	pnpm realtime:dev

worker:
	pnpm worker:dev

build:
	pnpm build

check:
	pnpm check

e2e:
	pnpm test:e2e

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

typecheck:
	pnpm typecheck

test:
	pnpm test

test-watch:
	pnpm test:watch

test-coverage:
	pnpm test:coverage

format:
	pnpm format

format-check:
	pnpm format:check

db-generate:
	pnpm db:generate

db-migrate-diff:
	pnpm db:migrate:diff

db-deploy:
	pnpm db:deploy

db-studio:
	pnpm db:studio

db-seed:
	pnpm db:seed

db-seed-prod:
	pnpm db:seed:prod

db-purge:
	pnpm db:purge

check-conflict:
	pnpm db:check-conflict

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-ps:
	docker compose ps

docker-deploy:
	./scripts/deploy-docker.sh

docker-size:
	@echo "── Image của dự án (theo compose):"
	@docker compose images 2>/dev/null || echo "   (chưa build)"
	@echo "── Image mồ côi (mỗi lần build lỗi để lại một bản):"
	@echo "   số lượng: $$(docker images -f 'dangling=true' -q | wc -l | tr -d ' ')"
	@docker system df

# Mỗi lần `docker build` thất bại giữa chừng, các layer đã tạo trở thành image
# không tên (<none>) và nằm lại vĩnh viễn. Vài lần build lỗi là mất chục GB.
# Lệnh này CHỈ xoá image không được tag và không container nào dùng — image
# đang chạy và image có tên đều an toàn.
docker-clean:
	docker image prune -f
	docker builder prune -f

# --- PM2 -------------------------------------------------------------------
# Quản lý tiến trình bằng PM2 trên VPS

pm2-deploy:
	./scripts/deploy-pm2.sh

pm2-start:
	pm2 start ecosystem.config.cjs --env production

pm2-stop:
	pm2 stop ecosystem.config.cjs

pm2-restart:
	pm2 restart ecosystem.config.cjs --env production

pm2-reload:
	pm2 reload ecosystem.config.cjs --env production

pm2-logs:
	pm2 logs

pm2-status:
	pm2 status

pm2-monit:
	pm2 monit

# --- VPS trực tiếp (systemd + Caddy) ---------------------------------------
# Các target dưới đây chạy TRÊN MÁY CHỦ, không phải máy dev.

SERVICE ?= chotsan

vps-deploy:
	./scripts/deploy-vps.sh

vps-logs:
	journalctl -u $(SERVICE) -f

vps-status:
	systemctl status $(SERVICE) $(SERVICE)-realtime $(SERVICE)-worker --no-pager

vps-files:
	@echo "Cài đặt lần đầu trên VPS:"
	@echo ""
	@echo "  sudo mkdir -p /etc/chotsan"
	@echo "  sudo cp .env.example /etc/chotsan/env   # rồi điền giá trị thật"
	@echo "  sudo chmod 600 /etc/chotsan/env"
	@echo ""
	@echo "  sudo cp deploy/chotsan.service deploy/chotsan-realtime.service deploy/chotsan-worker.service /etc/systemd/system/"
	@echo "  sudo systemctl daemon-reload"
	@echo "  sudo systemctl enable --now $(SERVICE) $(SERVICE)-realtime $(SERVICE)-worker"
	@echo "  # THIẾU unit realtime = web chạy nhưng WebSocket im lặng không tồn tại"
	@echo "  # REALTIME_ENABLED=0 / QUEUE_ENABLED=0 thì bỏ unit tương ứng — deploy-vps.sh tự disable"
	@echo ""
	@echo "  sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # đổi example.com"
	@echo "  sudo systemctl reload caddy"
	@echo ""
	@echo "  # (Tuỳ chọn) lưới dự phòng dọn dữ liệu hết hạn — lịch trong worker/web đã dọn mỗi ngày:"
	@echo "  sudo cp deploy/chotsan-purge.service deploy/chotsan-purge.timer /etc/systemd/system/"
	@echo "  sudo systemctl daemon-reload"
	@echo "  sudo systemctl enable --now chotsan-purge.timer"
	@echo ""
	@echo "VPS đã chạy nginx? Viết server block trỏ 127.0.0.1:3000, nhớ ghi đè X-Forwarded-For."
