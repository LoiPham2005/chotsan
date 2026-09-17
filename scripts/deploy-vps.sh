#!/usr/bin/env bash
#
# Deploy lên VPS chạy trực tiếp (không Docker).
#
#   ssh deploy@server
#   cd /var/www/chotsan && ./scripts/deploy-vps.sh
#
# Ghi đè mặc định bằng biến môi trường:
#   APP_DIR=/srv/app SERVICE=my-app ./scripts/deploy-vps.sh

# -e dừng ngay khi có lệnh lỗi, -u báo lỗi khi dùng biến chưa khai báo,
# pipefail để lỗi giữa pipe không bị nuốt. Thiếu ba cờ này thì script deploy
# vẫn báo "thành công" dù bước migrate đã chết.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/chotsan}"
SERVICE="${SERVICE:-chotsan}"
# Tiến trình WebSocket chạy riêng. Đặt REALTIME_SERVICE= (rỗng) nếu dự án của
# bạn không dùng realtime.
REALTIME_SERVICE="${REALTIME_SERVICE:-chotsan-realtime}"
# Tiến trình chạy job nền. Đặt WORKER_SERVICE= (rỗng) nếu chưa dùng hàng đợi.
WORKER_SERVICE="${WORKER_SERVICE:-chotsan-worker}"
ENV_FILE="${ENV_FILE:-/etc/chotsan/env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33m⚠️  %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR" || fail "Không vào được $APP_DIR"

# Nạp biến môi trường. Bước này bắt buộc: `prisma migrate deploy` và
# `next build` đều cần DATABASE_URL, mà file env nằm ngoài thư mục mã nguồn
# (xem deploy/chotsan.service).
if [ -f "$ENV_FILE" ]; then
	step "Nạp biến môi trường từ $ENV_FILE"
	set -a
	# shellcheck disable=SC1090
	. "$ENV_FILE"
	set +a
else
	fail "Không tìm thấy $ENV_FILE"
fi

# Unit đổi tên từ `nextjs-base*` (di sản bộ khung) sang `chotsan*`. Không tự gỡ
# unit cũ: trên VPS dùng chung, `nextjs-base` có thể là của dự án KHÁC.
if systemctl list-unit-files 'nextjs-base*' --no-legend 2>/dev/null | grep -q .; then
	warn "Còn unit tên cũ nextjs-base* trên máy này. Nếu chúng là của ChốtSân:"
	printf '     sudo systemctl disable --now nextjs-base nextjs-base-realtime nextjs-base-worker nextjs-base-purge.timer\n'
	printf '     rồi cài deploy/chotsan*.service|timer (env: /etc/chotsan/env) — chạy song song là tranh cổng 3000.\n'
fi

step "Lấy mã nguồn mới nhất"
# --ff-only: nếu lịch sử đã rẽ nhánh thì dừng lại, đừng tự merge trên
# production rồi để lại một commit không ai review.
git pull --ff-only

step "Cài dependencies"
corepack enable
# KHÔNG dùng --prod: bước build cần devDependencies (next, typescript, prisma).
pnpm install --frozen-lockfile

step "Áp migration database"
# `migrate deploy` chỉ áp migration đã commit, không bao giờ tự sinh mới và
# không bao giờ hỏi gì — đúng thứ cần cho production. Khác hẳn `migrate dev`.
pnpm db:deploy

step "Build"
pnpm build

# Realtime được esbuild gói thành `realtime/dist/server.cjs`. Bước này từng bị
# bỏ sót hoàn toàn: script chỉ build web, nên máy chủ WebSocket trên VPS mãi là
# bản cũ — hoặc chưa từng tồn tại.
if [ -d "realtime" ]; then
	step "Build realtime (WebSocket)"
	pnpm realtime:build
fi

if [ -d "worker" ]; then
	step "Build worker (job nền)"
	pnpm worker:build
fi

step "Khởi động lại service"
sudo systemctl restart "$SERVICE"

# Khởi động lại MỘT tiến trình phụ — tôn trọng cờ bật/tắt và trạng thái unit.
#
# Bản trước gọi `systemctl restart` cho mọi unit ĐÃ CÀI. `restart` khởi động cả
# unit đang dừng, nên unit đã bị `disable --now` vì cờ = 0 lại sống dậy sau mỗi
# lần deploy — rồi tự thoát, `Restart=always` bật lại, quay vòng tới `failed`.
#
#   - cờ = 0     → đảm bảo unit TẮT (disable --now), cùng tinh thần `replicas: 0`
#                  của compose và `pm2 delete` của deploy-pm2.sh;
#   - chưa cài   → cảnh báo, không làm deploy đỏ;
#   - bị disable tay (cờ vẫn bật) → không tự bật lại, chỉ cảnh báo;
#   - còn lại    → restart.
restart_optional() {
	local unit="$1" flag_name="$2" flag_value="$3" label="$4" missing_hint="$5"

	[ -n "$unit" ] || return 0

	if [ "$flag_value" = "0" ]; then
		if systemctl is-enabled --quiet "$unit" 2>/dev/null || systemctl is-active --quiet "$unit" 2>/dev/null; then
			step "Tắt $label ($flag_name=0)"
			sudo systemctl disable --now "$unit"
		else
			printf '  bỏ qua %s: %s=0\n' "$unit" "$flag_name"
		fi
		return 0
	fi

	if ! systemctl list-unit-files "$unit.service" --no-legend 2>/dev/null | grep -q .; then
		warn "Chưa cài $unit.service — $missing_hint"
		printf '     Cài: sudo cp deploy/%s.service /etc/systemd/system/ && sudo systemctl enable --now %s\n' "$unit" "$unit"
		return 0
	fi

	if ! systemctl is-enabled --quiet "$unit" 2>/dev/null; then
		warn "$unit đang bị disable dù $flag_name bật — KHÔNG tự bật lại. Bật: sudo systemctl enable --now $unit"
		return 0
	fi

	step "Khởi động lại $label"
	sudo systemctl restart "$unit"
}

# Restart tiến trình phụ SAU web.
restart_optional "$REALTIME_SERVICE" REALTIME_ENABLED "${REALTIME_ENABLED:-1}" "realtime" \
	"WebSocket sẽ KHÔNG chạy."
restart_optional "$WORKER_SERVICE" QUEUE_ENABLED "${QUEUE_ENABLED:-1}" "worker" \
	"job nền sẽ nằm trong hàng đợi mà KHÔNG ai chạy."

step "Kiểm tra sức khoẻ"
for attempt in $(seq 1 30); do
	if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
		printf '\n\033[1;32m✓ Deploy xong. Service đang khoẻ.\033[0m\n'
		curl -s "$HEALTH_URL"
		echo
		exit 0
	fi
	sleep 2
	printf '  chờ... (%s/30)\n' "$attempt"
done

# Không im lặng bỏ qua: service không lên được là deploy thất bại.
printf '\n\033[1;31m✗ Service không phản hồi sau 60 giây.\033[0m\n' >&2
journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
exit 1
