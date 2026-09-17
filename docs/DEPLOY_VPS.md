# Deploy lên VPS

Hướng dẫn đưa dự án lên một máy chủ Linux thật. Có **ba cách**, dùng chung phần
chuẩn bị ở mục 1 và 2 — đọc hai mục đó trước, rồi nhảy tới cách bạn chọn.

| Cách                                         | Chọn khi                                                         |
| -------------------------------------------- | ---------------------------------------------------------------- |
| [Docker Compose](#4-cách-a--docker-compose)  | Muốn nhanh và gọn nhất. Dựng luôn cả Postgres + Redis.           |
| [systemd + Caddy](#5-cách-b--systemd--caddy) | VPS nhỏ (1GB RAM), hoặc đã có Postgres sẵn. Siết quyền tốt nhất. |
| [PM2](#6-cách-c--pm2)                        | Quen PM2 rồi, hoặc cần `reload` không rớt kết nối.               |

Cả ba đều chạy **ba tiến trình**:

| Tiến trình | Việc                                 | Thiếu nó thì sao (khi `QUEUE_ENABLED=1`)                                                          |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `web`      | Next.js                              | Không có gì chạy                                                                                  |
| `realtime` | WebSocket                            | Web vẫn chạy, realtime im lặng không hoạt động                                                    |
| `worker`   | Job nền (BullMQ) + **job theo lịch** | **Mọi email nằm trong hàng đợi mà không ai gửi**; không nhả giao dịch quá hạn, không xuất hoá đơn |

Tên dùng xuyên suốt tài liệu này (khớp `deploy/`, `scripts/`, `ecosystem.config.cjs`):

| Thứ              | Giá trị                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| Thư mục mã nguồn | `/var/www/chotsan`                                                               |
| File môi trường  | `/etc/chotsan/env`                                                               |
| Unit systemd     | `chotsan`, `chotsan-realtime`, `chotsan-worker`, `chotsan-purge.{service,timer}` |
| App PM2          | `chotsan`, `chotsan-realtime`, `chotsan-worker`                                  |

⚠️ **Máy đã từng deploy bằng tên cũ `nextjs-base*`** (di sản bộ khung): tắt unit/app
cũ trước khi cài tên mới, nếu không hai bản tranh nhau cổng 3000.
`scripts/deploy-vps.sh` và `scripts/deploy-pm2.sh` chỉ CẢNH BÁO chứ không tự gỡ —
trên VPS dùng chung, `nextjs-base` có thể là của dự án khác.

```bash
# systemd
sudo systemctl disable --now nextjs-base nextjs-base-realtime nextjs-base-worker nextjs-base-purge.timer
# PM2
pm2 delete nextjs-base nextjs-base-realtime nextjs-base-worker && pm2 save
```

Cả hai tiến trình phụ đều hỏng trong im lặng — không có lỗi nào báo cho bạn
biết. Riêng `worker` đáng chú ý nhất: từ khi email đi qua hàng đợi, thiếu
worker nghĩa là **không lá thư nào được gửi**, kể cả email đặt lại mật khẩu.
Kiểm bằng `/api/health` (mục 7).

---

## 1. Chuẩn bị máy chủ

Cấu hình tối thiểu: **2GB RAM** nếu dùng Docker (vì có thêm Postgres + Redis
trong container), **1GB RAM** nếu dùng systemd/PM2 với Postgres đặt ở nơi khác.

```bash
# Trên VPS, với quyền root
adduser deploy
usermod -aG sudo deploy

# Khoá đăng nhập bằng mật khẩu — chỉ cho vào bằng SSH key.
# Làm bước này TRƯỚC khi mở cổng ra Internet.
ssh-copy-id deploy@<ip-server>     # chạy từ máy bạn
```

Trong `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl restart ssh

# Tường lửa: chỉ mở SSH và HTTP(S).
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

⚠️ **`ufw` KHÔNG chặn được cổng do Docker công bố.** Đây là cái bẫy khiến rất
nhiều VPS bị lộ database mà chủ máy tin là đã đóng. Docker tự ghi luật vào
chuỗi `DOCKER` của iptables, nằm TRƯỚC luật của ufw — chạy `ufw deny 5432`
xong vẫn kết nối từ ngoài vào được như thường.

Cách chặn duy nhất đáng tin: **bind cổng vào `127.0.0.1` ngay trong compose**.
`docker-compose.yml` của dự án đã làm sẵn cho cả ba cổng công bố (Postgres 5432,
web 3000, realtime 3002; Redis và worker không công bố cổng nào):

```yaml
ports:
  - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
```

Đường systemd/PM2 cũng chỉ nghe loopback: web `HOSTNAME=127.0.0.1`, realtime và
`/health` của worker nghe `127.0.0.1` (biến `HOST`, mặc định). Caddy là cửa duy
nhất ra Internet.

Kiểm tra lại trên VPS sau khi deploy — chạy TỪ MÁY BẠN, không phải từ VPS:

```bash
nc -zv <ip-server> 5432    # mong đợi: refused / timeout
nc -zv <ip-server> 3000    # mong đợi: refused / timeout
nc -zv <ip-server> 3002    # mong đợi: refused / timeout
```

Nếu các lệnh trên kết nối được thì cổng đang mở ra Internet — sửa ngay.

---

## 2. Chuẩn bị file môi trường

Đây là bước dễ sai nhất, và sai thì app không khởi động được — `src/lib/env.ts`
validate toàn bộ biến ngay lúc chạy, thiếu là dừng luôn kèm thông báo chỉ rõ
biến nào.

```bash
sudo mkdir -p /etc/chotsan
sudo cp .env.example /etc/chotsan/env
sudo chmod 600 /etc/chotsan/env      # chứa SESSION_SECRET
sudo nano /etc/chotsan/env
```

(Chạy từ thư mục mã nguồn — lấy mã ở [mục 3](#3-lấy-mã-nguồn) trước.)

### Bắt buộc

| Biến             | Ghi chú                                                      |
| ---------------- | ------------------------------------------------------------ |
| `DATABASE_URL`   | `postgresql://user:pass@host:5432/db?schema=public`          |
| `SESSION_SECRET` | Sinh bằng `openssl rand -base64 48`. **Tối thiểu 32 ký tự.** |

### Gần như luôn cần

| Biến                                  | Vì sao                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                             | Gốc URL công khai (`https://ten-mien`). Link email, OAuth, passkey dựng từ `APP_URL`, thiếu thì lấy `NEXT_PUBLIC_APP_URL`. Thiếu cả hai là **gửi mail ném lỗi**.                                                                                                                          |
| `NEXT_PUBLIC_APP_URL`                 | Cùng giá trị với `APP_URL` — Next nhúng vào bundle lúc BUILD.                                                                                                                                                                                                                             |
| `SMTP_HOST` (+ `SMTP_*`, `MAIL_FROM`) | Production thiếu SMTP (và chưa `setMailer()`) thì mọi email **ném lỗi**; web log lỗi ngay lúc khởi động.                                                                                                                                                                                  |
| `REDIS_URL`                           | Hàng đợi + worker, rate limit dùng chung giữa các tiến trình. Xem cảnh báo bên dưới.                                                                                                                                                                                                      |
| `TRUSTED_PROXY_HOPS`                  | Mặc định `1` — `deploy/Caddyfile` GHI ĐÈ `X-Forwarded-For` bằng IP thật. Có thêm tầng phía trước NỐI IP vào header (Cloudflare, load balancer) thì tăng theo số tầng (xem chú thích trong `.env.example`). Lớn hơn thực tế = mọi người chung một bộ đếm; nhỏ hơn = client tự khai IP giả. |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD`      | `pnpm db:seed:prod` cần để tạo tài khoản quản trị đầu tiên.                                                                                                                                                                                                                               |

⚠️ **`SESSION_SECRET` phải giống hệt nhau giữa `web` và `realtime`.** Token do
web cấp được verify ở realtime; lệch một ký tự là mọi kết nối WebSocket bị từ
chối, và thông báo lỗi chỉ là `unauthorized` chung chung.

⚠️ **Realtime và worker cũng cần `DATABASE_URL` thật.** Realtime tra database lúc
bắt tay để từ chối phiên đã thu hồi (đổi mật khẩu, bị khoá, bị xoá); worker chạy
job qua tầng service. Đường systemd/PM2 dùng chung một file env nên tự có.

⚠️ **Về `REDIS_URL`**: bỏ trống thì rate limit đếm trong RAM của từng tiến
trình. Chạy **một** tiến trình thì không sao. Từ tiến trình thứ hai trở đi,
ngưỡng chống brute-force bị nhân lên theo số tiến trình — im lặng, không log.
Chạy nhiều instance thì bắt buộc phải có Redis. Với `QUEUE_ENABLED=1` (mặc
định), thiếu `REDIS_URL` trên production thì `enqueue()` **ném lỗi** và không ai
chạy job theo lịch.

### Tuỳ chọn — tắt bớt tiến trình không dùng

Dự án dựng sẵn ba tiến trình: `web`, `realtime` (WebSocket), `worker` (job nền).
Không phải dự án nào cũng cần đủ ba. Hai biến dưới đây tắt hẳn tiến trình tương
ứng ở **cả ba cách deploy**:

| Biến               | `1` (mặc định)                             | `0`                                                                                     |
| ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `QUEUE_ENABLED`    | Job vào Redis, `worker` xử lý và chạy lịch | `enqueue()` chạy job ngay trong request; **web tự chạy job theo lịch**; không cần Redis |
| `REALTIME_ENABLED` | Dựng tiến trình WebSocket                  | Không dựng                                                                              |

⚠️ **Chỉ nhận `1` hoặc `0`, không nhận `true`/`false`.** Chính hai biến này được
`docker-compose.yml` dùng làm `deploy.replicas`, mà Compose chỉ hiểu số — đặt
`false` là nó dừng ngay với `strconv.Atoi: parsing "false"`. Dùng chung một biến
cho cả app lẫn hạ tầng là có chủ đích: tách đôi thì sẽ có ngày app đẩy job vào
Redis trong khi không worker nào chạy, và chuyện đó xảy ra hoàn toàn trong im lặng.

Tắt hàng đợi **không mất job theo lịch** (nhả chỗ giữ/giao dịch quá hạn mỗi phút,
dọn dữ liệu 03:00, xuất hoá đơn 02:30, đánh dấu quá hạn 04:00 — giờ Việt Nam):
tiến trình web tự chạy chúng (`src/jobs/schedules.ts`, khởi động từ
`src/instrumentation.ts`). Cái mất là thử lại tự động qua hàng đợi: đang bật, một
lần SMTP nghẽn chỉ làm job lùi vài giây; tắt đi thì lỗi bung thẳng ra request và
người dùng đăng ký hỏng. Dự án gửi mail thật nên để bật.

Cách tắt theo từng đường deploy:

```bash
# Docker Compose — sửa .env rồi up lại. Container đang chạy sẽ bị GỠ, không bỏ mặc.
QUEUE_ENABLED=0 REALTIME_ENABLED=0
docker compose up -d

# systemd — biến trong /etc/chotsan/env chỉ làm tiến trình tự thoát, mà
# `Restart=always` thì bật lại ngay. Phải tắt ở tầng unit (deploy-vps.sh tự làm
# việc này khi đọc thấy cờ = 0):
sudo systemctl disable --now chotsan-worker
sudo systemctl disable --now chotsan-realtime

# PM2 — ecosystem.config.cjs đọc biến của SHELL (không đọc .env), nên nạp trước.
# deploy-pm2.sh tự nạp /etc/chotsan/env và `pm2 delete` app đã bị lọc:
set -a && . /etc/chotsan/env && set +a
pnpm pm2:start
```

⚠️ Tắt realtime thì **bỏ luôn khối `/socket.io/*` trong Caddyfile**. Để lại thì
proxy trả 502 (trông như dịch vụ hỏng) thay vì 404 (đúng: không có ở đây).

Kiểm tra deploy đang bật những gì: `curl -s https://ten-mien/api/health` trả
`"features":{"queue":"redis","realtime":"on","schedules":"worker"}`.

- `queue`: `redis` (chạy nền thật), `inline` (cờ bật nhưng thiếu `REDIS_URL`, gần
  như luôn là nhầm), `off` (đã tắt có chủ đích).
- `schedules` — ai chạy job theo lịch: `worker`, `in-process` (web tự chạy, khi
  `QUEUE_ENABLED=0`), `off` (**không ai chạy** — bật cờ mà thiếu `REDIS_URL`; trên
  production phải sửa ngay).

---

## 3. Lấy mã nguồn

```bash
sudo mkdir -p /var/www/chotsan
sudo chown deploy:deploy /var/www/chotsan
git clone <repo-url> /var/www/chotsan
cd /var/www/chotsan
```

---

## 4. Cách A — Docker Compose

Gọn nhất: một lệnh dựng cả Postgres, Redis, migrate, web, realtime, worker.

```bash
# Cài Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
# Đăng xuất rồi vào lại để nhóm docker có hiệu lực

cp /etc/chotsan/env .env      # compose đọc .env ở gốc dự án
docker compose up -d --build
```

Kiểm tra:

```bash
docker compose ps                              # migrate phải ở trạng thái "exited (0)"
curl -s http://127.0.0.1:3000/api/health
```

Tạo tài khoản quản trị lần đầu (chạy một lần):

```bash
docker compose run --rm tools pnpm db:seed:prod
```

Lệnh này dùng service `tools` — một container dùng-một-lần nằm sau profile
`tools`, nên `docker compose up` không bao giờ chạm tới nó. Nó cũng là nơi chạy
mọi tác vụ vận hành khác:

```bash
docker compose run --rm tools pnpm db:purge      # dọn token hết hạn
docker compose run --rm tools npx prisma migrate status
```

⚠️ Cần `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env` trước khi seed. Ở
production, thiếu hai biến này thì seed **dừng và báo lỗi** thay vì tạo tài
khoản với mật khẩu mặc định — đó là chủ ý.

### Deploy lần sau

```bash
./scripts/deploy-docker.sh     # pull → build → up → health check → dọn image cũ
```

### Dọn token định kỳ

Không bắt buộc nữa: lịch `maintenance-purge-expired` (worker, hoặc web khi
`QUEUE_ENABLED=0`) đã dọn mỗi ngày lúc 03:00 giờ Việt Nam. Chỉ thêm cron dưới
đây làm lưới dự phòng khi `features.schedules` là `off`:

```bash
crontab -e
```

```
0 3 * * * cd /var/www/chotsan && docker compose run --rm tools pnpm db:purge >/dev/null 2>&1
```

Bảng `refresh_tokens` và `verification_tokens` chỉ tăng — mỗi lần đăng nhập
thêm một dòng, mỗi lần bấm "quên mật khẩu" thêm một dòng, kể cả khi người dùng
không bao giờ mở email.

---

## 5. Cách B — systemd + Caddy

Nhẹ nhất và siết quyền chặt nhất. Postgres cài riêng.

```bash
# Node 24 + pnpm
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable

# Postgres
sudo apt install -y postgresql
sudo -u postgres createuser --pwprompt appuser
sudo -u postgres createdb -O appuser chotsan

# Redis (bỏ qua nếu QUEUE_ENABLED=0 và chỉ chạy 1 tiến trình)
sudo apt install -y redis-server
```

Build và cài service:

```bash
cd /var/www/chotsan
set -a && . /etc/chotsan/env && set +a   # db:deploy và build cần DATABASE_URL
pnpm install --frozen-lockfile
pnpm db:deploy             # áp migration đã commit — KHÔNG dùng migrate dev / db push
pnpm build
pnpm realtime:build
pnpm worker:build
pnpm db:seed:prod          # tạo quyền, môn và admin lần đầu

sudo cp deploy/chotsan.service deploy/chotsan-realtime.service deploy/chotsan-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chotsan chotsan-realtime chotsan-worker
```

⚠️ **Đừng quên hai unit phụ.** Cài thiếu `chotsan-realtime` thì WebSocket
không tồn tại; cài thiếu `chotsan-worker` (khi `QUEUE_ENABLED=1`) thì **không
email nào được gửi** và không job theo lịch nào chạy — job nằm nguyên trong Redis.
`deploy-vps.sh` sẽ cảnh báo unit chưa cài, nhưng lần cài đầu thì không ai báo.

⚠️ **`worker` bắt buộc có `REDIS_URL`** trong `/etc/chotsan/env`. Khác web
và realtime, nó dừng ngay với thông báo rõ ràng nếu thiếu — thay vì ngồi im.
Không dùng hàng đợi thì đặt `QUEUE_ENABLED=0` và **đừng cài** `chotsan-worker`
(hoặc `sudo systemctl disable --now chotsan-worker`).

Dọn token định kỳ — tuỳ chọn, lưới dự phòng cho lịch trong worker/web (systemd
timer, không cần crontab):

```bash
sudo cp deploy/chotsan-purge.service deploy/chotsan-purge.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chotsan-purge.timer
systemctl list-timers chotsan-purge.timer    # xác nhận đã lên lịch
```

Reverse proxy:

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # đổi example.com thành domain thật
sudo systemctl reload caddy
```

Caddy tự xin và tự gia hạn chứng chỉ Let's Encrypt — không cần certbot, không
cần cron. Điều kiện: domain đã trỏ A/AAAA về IP máy này, cổng 80 và 443 mở
(cổng 80 dùng cho ACME challenge). `deploy/Caddyfile` GHI ĐÈ `X-Forwarded-For`
bằng IP thật của client — khớp `TRUSTED_PROXY_HOPS=1`.

⚠️ **`Caddyfile` phải có khối định tuyến `/socket.io/*` sang cổng 3002.** Thiếu
nó thì tiến trình realtime chạy bình thường, `systemctl status` xanh, log sạch
— nhưng client từ Internet không có đường nào tới nó vì proxy đẩy hết sang cổng 3000. File `deploy/Caddyfile` trong repo đã có sẵn khối này; nếu bạn dùng nginx
thì phải tự viết `location /socket.io/` kèm `proxy_set_header Upgrade` và
`Connection "upgrade"`.

### Deploy lần sau

```bash
./scripts/deploy-vps.sh     # nạp env → pull → install → db:deploy → build (web, realtime, worker) → restart → health check
```

Script đọc `/etc/chotsan/env` rồi xử lý từng tiến trình phụ theo cờ:

- cờ `=0` → `systemctl disable --now` unit tương ứng;
- unit chưa cài → cảnh báo kèm lệnh cài, không làm deploy đỏ;
- unit bị bạn `disable` tay trong khi cờ vẫn bật → **không tự bật lại**, chỉ cảnh báo;
- còn lại → `restart`.

Ghi đè mặc định bằng biến: `APP_DIR`, `SERVICE`, `REALTIME_SERVICE`,
`WORKER_SERVICE`, `ENV_FILE`, `HEALTH_URL`.

### Xem log

```bash
journalctl -u chotsan -f
journalctl -u chotsan-realtime -f
journalctl -u chotsan-worker -f
```

---

## 6. Cách C — PM2

Cùng mô hình với cách B (chạy trực tiếp trên máy, Postgres cài riêng), chỉ khác
cái quản tiến trình. Điểm mạnh: `pm2 reload` nạp lại **không rớt kết nối**.

Làm hết phần cài Node/Postgres/Redis và Caddy ở [cách B](#5-cách-b--systemd--caddy)
— **kể cả khối `/socket.io/*` trong Caddyfile**, PM2 cũng cần nó — rồi **bỏ qua**
bước `systemctl`, thay bằng:

```bash
sudo npm install -g pm2

cd /var/www/chotsan
cp /etc/chotsan/env .env           # tiến trình PM2 nạp .env ở gốc dự án (--env-file-if-exists)
./scripts/deploy-pm2.sh            # nạp /etc/chotsan/env → pull → install → db:deploy → build → startOrReload

pm2 save                            # ghi lại danh sách tiến trình
pm2 startup                          # in ra lệnh cần chạy để tự khởi động sau reboot
```

`ecosystem.config.cjs` khai ba app: `chotsan` (web, cluster), `chotsan-realtime`
(fork), `chotsan-worker` (fork, `kill_timeout` 60 giây). App có cờ `=0` bị lọc
khỏi danh sách và `deploy-pm2.sh` gọi `pm2 delete` cho nó.

⚠️ Sửa `/etc/chotsan/env` thì nhớ chép lại sang `.env` — hai file phải khớp.

### Về số instance

`ecosystem.config.cjs` mặc định chạy **1 instance**, có chủ đích.

Muốn tận dụng đa nhân thì phải đặt `REDIS_URL` trước:

```bash
PM2_INSTANCES=max pm2 start ecosystem.config.cjs --env production
```

Nếu quên Redis, file cấu hình sẽ **dừng lại và báo lỗi** thay vì cho chạy — vì
mỗi tiến trình đếm rate limit riêng, chạy 8 nhân là ngưỡng đăng nhập bị nhân
8 lần mà không có dấu hiệu gì.

`realtime` **luôn 1 instance** kể cả khi web chạy cluster: Socket.IO cần adapter
Redis mới phát tin được giữa các tiến trình, thiếu nó thì client nối vào tiến
trình A không nhận được tin từ B. Worker chỉnh bằng `PM2_WORKER_INSTANCES`
(mặc định 1).

⚠️ `QUEUE_ENABLED=0` + web nhiều instance = mỗi instance tự chạy lịch, mỗi mốc chạy
N lần. An toàn vì mọi job theo lịch idempotent, nhưng tốn truy vấn — nhiều instance
thì nên dùng Redis + worker.

### Dọn token định kỳ

Tuỳ chọn — lịch trong worker/web đã dọn mỗi ngày. Lưới dự phòng:

```bash
crontab -e
```

```
0 3 * * * cd /var/www/chotsan && /usr/bin/pnpm db:purge >/dev/null 2>&1
```

### Lệnh hay dùng

```bash
pm2 status
pm2 logs
pm2 reload ecosystem.config.cjs --env production    # không rớt kết nối
pm2 monit
```

---

## 7. Sau khi deploy — kiểm tra 6 điểm

Chạy hết 6 lệnh dưới đây. Mỗi lệnh bắt một loại lỗi khác nhau, và mấy lỗi này
đều thuộc loại "im lặng" — không tự lộ ra cho tới khi có người dùng thật gặp.

```bash
# 1. Web sống, nối được database, và có người chạy job theo lịch
curl -s https://your-domain.com/api/health
# mong đợi: {"status":"ok","database":"up",...,"features":{"queue":"redis","realtime":"on","schedules":"worker"}}
# `schedules` phải là "worker" hoặc "in-process" — "off" là không ai chạy lịch.

# 2. Realtime sống  (chạy TRÊN máy chủ — cổng này chỉ nghe 127.0.0.1)
curl -s http://127.0.0.1:3002/health
# mong đợi: {"status":"ok","connections":0}

# 2b. Worker sống VÀ nối được hàng đợi (cũng chỉ nghe 127.0.0.1)
curl -s http://127.0.0.1:3003/health
# mong đợi: {"status":"ok","counts":{"waiting":0,"active":0,"delayed":0,"failed":0}}
# 503 (trả sau ~2 giây) = mất kết nối Redis. `failed` tăng dần = job đang hỏng, xem log worker.

# 3. API trả JSON, không phải HTML chuyển hướng
curl -s -i https://your-domain.com/api/v1/users | head -3
# mong đợi: HTTP 401 + content-type: application/json

# 4. HTTPS và header bảo mật
curl -sI https://your-domain.com | grep -i "strict-transport\|content-security"

# 5. Đăng nhập được bằng tài khoản admin vừa seed
#    (mở trình duyệt vào /login)

# 6. Rate limit đang chạy: gọi sai mật khẩu 6 lần liên tiếp phải nhận 429 (kèm Retry-After)
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://your-domain.com/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"identifier":"khong-ton-tai@example.com","password":"sai"}'
done; echo
# mong đợi: 401 401 401 401 401 429
# Web và API dùng CHUNG một xô đếm theo IP — sau bước này, đăng nhập trên web từ
# cùng IP cũng bị chặn tới hết cửa sổ 5 phút.
```

---

## 8. Sao lưu database

**Chưa có gì tự động.** Self-host Postgres nghĩa là mất VPS là mất dữ liệu.
Thiết lập ngay sau khi deploy lần đầu, đừng để sau:

```bash
crontab -e
```

```
# Dump mỗi ngày lúc 2h, giữ 14 ngày gần nhất
0 2 * * * pg_dump "$DATABASE_URL" | gzip > /var/backups/db-$(date +\%F).sql.gz
0 4 * * * find /var/backups -name 'db-*.sql.gz' -mtime +14 -delete
```

⚠️ Cron không nạp `/etc/chotsan/env` — `$DATABASE_URL` ở trên phải được khai
trong crontab hoặc thay bằng chuỗi kết nối thật.

⚠️ Dump nằm cùng máy với database thì không phải backup — nó chỉ cứu được khi
xoá nhầm bảng, không cứu được khi mất máy. Đẩy lên object storage
(S3/R2/Vietnix) và **thử khôi phục ít nhất một lần** để biết bản dump dùng
được. Chi tiết: [disaster-recovery.md](disaster-recovery.md).

---

## 9. Sự cố thường gặp

| Triệu chứng                                                                                    | Nguyên nhân hay gặp                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| App không khởi động, log ghi "Cấu hình môi trường không hợp lệ"                                | Thiếu biến bắt buộc. Thông báo có chỉ rõ tên biến — đọc nó.                                                                                         |
| Log "Cấu hình lịch chạy job không hợp lệ" (web) / "Cấu hình worker không hợp lệ" nhắc `CRON_*` | Một biến `CRON_*` sai cú pháp hoặc không bao giờ tới (vd `0 0 31 2 *`).                                                                             |
| `/api/health` trả 503                                                                          | Web sống nhưng không nối được database. Kiểm tra `DATABASE_URL` và firewall của Postgres.                                                           |
| `features.schedules` là `off`                                                                  | `QUEUE_ENABLED=1` mà thiếu `REDIS_URL` — không ai nhả giao dịch quá hạn, không xuất hoá đơn. Đặt `REDIS_URL` + chạy worker, hoặc `QUEUE_ENABLED=0`. |
| WebSocket không kết nối                                                                        | Chưa cài/chạy tiến trình realtime, `SESSION_SECRET` lệch giữa hai tiến trình, hoặc realtime không nối được database.                                |
| Gửi email ném lỗi                                                                              | Thiếu cả `APP_URL` lẫn `NEXT_PUBLIC_APP_URL`, hoặc thiếu `SMTP_HOST` (chưa gọi `setMailer()`).                                                      |
| `POST /api/v1/files` trả 503                                                                   | Chưa cắm kho lưu trữ tệp (`setStorage`) — production không ghi đĩa.                                                                                 |
| Rate limit như không có tác dụng                                                               | Đang chạy nhiều tiến trình mà thiếu `REDIS_URL`.                                                                                                    |
| Mọi người cùng bị 429 một lúc                                                                  | `TRUSTED_PROXY_HOPS` sai với số tầng proxy thật → mọi request bị đếm dưới IP của proxy.                                                             |
| `chotsan` không lên được, cổng 3000 bị chiếm                                                   | Còn unit/app PM2 tên cũ `nextjs-base*` đang chạy — xem đầu tài liệu.                                                                                |
| Container chết ngay khi khởi động, `MODULE_NOT_FOUND`                                          | Next truy vết thiếu file vào bản standalone — xem `outputFileTracingIncludes` trong `next.config.mjs`.                                              |
| Đăng nhập thành công nhưng bị đá ra ngay                                                       | `SESSION_SECRET` đổi giữa hai lần deploy → mọi cookie cũ thành không hợp lệ.                                                                        |

Thêm các bẫy đã gặp thật: [GOTCHAS.md](GOTCHAS.md).

---

## 10. Rollback

| Cách    | Lệnh                                                            |
| ------- | --------------------------------------------------------------- |
| Docker  | `docker compose up -d --no-build` với image tag cũ (nhanh nhất) |
| systemd | `git checkout <commit-cũ> && ./scripts/deploy-vps.sh`           |
| PM2     | `git checkout <commit-cũ> && ./scripts/deploy-pm2.sh`           |

⚠️ Hai script deploy chạy `git pull --ff-only` — đang ở commit tách rời (detached
HEAD) thì bước pull báo lỗi. Rollback bằng tay: `git checkout <commit-cũ>` rồi
chạy từng bước build + restart như mục 5/6, hoặc tạo nhánh tạm.

⚠️ **Migration database không tự lùi được.** Prisma Migrate chỉ tiến, không
lùi. Trước khi deploy một migration có xoá cột hoặc đổi kiểu dữ liệu, hãy dump
database trước — rollback mã nguồn mà schema đã đổi thì app bản cũ không chạy
được với schema mới.

Chi tiết quy trình khôi phục: [disaster-recovery.md](disaster-recovery.md).
