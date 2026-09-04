# Deploy bằng Coolify

Hướng dẫn đưa **chính dự án này** lên VPS bằng Coolify. Phần cài đặt Coolify và
khái niệm chung nằm ở
[HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md](HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md)
— file này chỉ nói phần riêng của dự án: biến môi trường nào bắt buộc, tại sao
phải chọn Docker Compose, và ba chỗ dễ sai nhất.

> Tên các mục trong giao diện Coolify có thể đổi theo phiên bản. Bám vào **ý
> nghĩa** của từng bước, đừng bám cứng vào nhãn nút.

---

## 1. Vì sao phải chọn build pack **Docker Compose**

Coolify cho chọn nhiều kiểu: Nixpacks, Dockerfile, Docker Compose… Với dự án
này chỉ có Docker Compose là đúng, vì nó cần **năm thứ chạy cùng nhau**:

| Service    | Vai trò                                                         |
| ---------- | --------------------------------------------------------------- |
| `postgres` | Database                                                        |
| `migrate`  | Chạy một lần rồi thoát — áp migration TRƯỚC khi `web` khởi động |
| `web`      | Next.js                                                         |
| `redis`    | Rate limit dùng chung + adapter cho realtime                    |
| `realtime` | WebSocket, **tiến trình riêng**                                 |
| `worker`   | Job nền — thiếu nó thì **không email nào được gửi**             |

Chọn Nixpacks hay Dockerfile thì Coolify chỉ dựng đúng một container `web`.
Hậu quả: không có migrate (schema chưa tạo → app chết ngay), và không có
realtime (WebSocket im lặng không hoạt động, **không có lỗi nào báo**).

`docker-compose.yml` trong repo đã sẵn sàng, không cần sửa gì để deploy.

---

## 2. Tạo resource

1. **New Resource** → **Docker Compose**
2. Trỏ tới repo + branch (`main`)
3. Coolify tự phát hiện `docker-compose.yml` ở gốc repo

⚠️ Nếu Coolify hỏi "Docker Compose Location", để nguyên `/docker-compose.yml`.

### Không cần cài Caddy, cũng không cần cài Docker

Coolify **tự cài Docker** khi bạn cài nó, và **tự chạy reverse proxy riêng**.
Proxy đó lo luôn việc gắn domain và xin chứng chỉ Let's Encrypt.

Proxy cụ thể là gì:

| Proxy       | Coolify dùng?                             |
| ----------- | ----------------------------------------- |
| **Traefik** | ✅ Mặc định                               |
| **Caddy**   | ⚙️ Có, chọn được trong **Server → Proxy** |
| **nginx**   | ❌ Không hỗ trợ                           |

Nó chạy dưới dạng container tên `coolify-proxy`, giữ cổng 80/443 của máy chủ.
Coolify thay đổi khá nhanh giữa các bản, nên kiểm tra trực tiếp cho chắc:

```bash
docker ps --filter name=coolify-proxy --format '{{.Image}}'
# traefik:v3.x → Traefik   |   caddy:2.x → Caddy
```

Vì vậy khi dùng Coolify:

| Thứ                             | Có cần không                                             |
| ------------------------------- | -------------------------------------------------------- |
| Docker                          | ✅ Có dùng — nhưng Coolify tự cài, bạn không cài tay     |
| `docker-compose.yml` trong repo | ✅ Chính là thứ Coolify deploy                           |
| Cài Caddy tay                   | ❌ **Không.** Sẽ tranh cổng 80/443 với proxy của Coolify |
| `deploy/Caddyfile`              | ❌ Không dùng tới — file đó chỉ cho hướng systemd/PM2    |
| `deploy/*.service` (systemd)    | ❌ Không dùng tới                                        |

Hệ quả quan trọng: việc định tuyến `/socket.io/*` (mục 5.2) phải làm **trong
giao diện Coolify hoặc bằng Traefik label**, không phải sửa `deploy/Caddyfile`
— file đó không được nạp trong luồng này.

### Cổng: điểm khác biệt lớn nhất khi chạy nhiều dự án

`docker-compose.yml` có công bố cổng ra máy chủ (`127.0.0.1:3000`,
`127.0.0.1:5432`, `127.0.0.1:3002`). Chúng đã bind vào loopback nên **an toàn**,
nhưng vẫn chiếm cổng trên máy chủ.

Chạy dự án thứ hai trên cùng VPS mà không đổi gì thì Coolify sẽ báo
`port is already allocated`. Cách xử lý: đặt cho mỗi dự án một bộ cổng riêng
trong phần biến môi trường:

| Biến            | Dự án 1 | Dự án 2 |
| --------------- | ------- | ------- |
| `APP_PORT`      | 3000    | 3010    |
| `POSTGRES_PORT` | 5432    | 5433    |
| `REALTIME_PORT` | 3002    | 3012    |

Những cổng này chỉ dùng để bạn `curl` kiểm tra hoặc nối DBeaver qua SSH tunnel.
Proxy của Coolify nói chuyện với container qua **network nội bộ của Docker**,
không đi qua cổng công bố — nên đổi chúng không ảnh hưởng gì tới domain.

---

## 3. Biến môi trường

Đây là phần dễ sai nhất và cũng là phần app kiểm tra gắt nhất: `src/lib/env.ts`
validate toàn bộ biến ngay lúc khởi động. Thiếu là container chết ngay kèm
thông báo chỉ rõ **tên biến nào** — đọc log là biết, đừng đoán.

### Bắt buộc

| Biến                | Giá trị                                        |
| ------------------- | ---------------------------------------------- |
| `SESSION_SECRET`    | `openssl rand -base64 48` — tối thiểu 32 ký tự |
| `POSTGRES_PASSWORD` | Mật khẩu Postgres. **Đừng để `postgres`.**     |

`DATABASE_URL` **không cần điền**: `docker-compose.yml` tự dựng nó từ
`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` và trỏ tới service
`postgres` trong cùng network.

### Gần như luôn cần

| Biến                   | Vì sao                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`  | `https://<domain-that>` — xem mục 5.1, **rất dễ sai**                    |
| `ADMIN_EMAIL`          | Tài khoản quản trị đầu tiên                                              |
| `ADMIN_PASSWORD`       | Đặt mạnh. Ở production, thiếu là seed **dừng** chứ không tự đặt mặc định |
| `POSTGRES_USER`        | Mặc định `postgres`                                                      |
| `POSTGRES_DB`          | Mặc định `chotsan`                                            |
| `REALTIME_CORS_ORIGIN` | `https://<domain-that>` — thiếu thì trình duyệt chặn WebSocket vì CORS   |

`REDIS_URL` **không cần điền**: compose đã set sẵn `redis://redis:6379` cho cả
`web` và `realtime`.

### Tuỳ chọn — tắt bớt service không dùng

| Biến               | `1` (mặc định)          | `0`                                                       |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| `QUEUE_ENABLED`    | Dựng service `worker`   | Không dựng; job chạy thẳng trong request, không cần Redis |
| `REALTIME_ENABLED` | Dựng service `realtime` | Không dựng                                                |

Hai biến này được compose dùng làm `deploy.replicas` của service tương ứng, nên
đặt `0` là **Coolify không dựng container đó** — và nếu nó đang chạy thì lần
deploy sau sẽ gỡ đi.

⚠️ **Chỉ nhận `1` hoặc `0`.** Điền `false` là deploy dừng ngay ở bước đọc
compose với `strconv.Atoi: parsing "false": invalid syntax`. Cùng biến đó cũng
là thứ app đọc để quyết định có đẩy job vào Redis hay không — một biến, nên
không có chuyện hạ tầng và app hiểu khác nhau.

⚠️ Tắt `realtime` thì bỏ luôn phần định tuyến WebSocket ở mục 5.2, nếu không
Traefik trả 502 thay vì 404.

Kiểm tra sau khi deploy: `curl -s https://<domain>/api/health` trả
`"features":{"queue":"redis","realtime":"on"}`.

### Không cần đụng tới

`PORT`, `HOSTNAME`, `NODE_ENV`, `REALTIME_PORT` — compose và Dockerfile đã set.

---

## 4. HTTPS — Coolify lo, nhưng có điều kiện

Coolify không tự viết phần HTTPS — nó chạy **Traefik** (mặc định, bản v3) làm
reverse proxy, và Traefik lo toàn bộ:

- xin chứng chỉ Let's Encrypt qua ACME (mặc định dùng HTTP-01 challenge),
- tự gia hạn trước khi hết hạn,
- chuyển hướng `http://` → `https://` bằng một middleware Coolify gắn sẵn.

Chứng chỉ được lưu trên máy chủ (thường trong `/data/coolify/proxy/`), không
phải trong container app — nên rebuild app không làm mất chứng chỉ.

Bạn không phải cài certbot, không phải viết cron gia hạn, không phải đụng tới
`deploy/Caddyfile` của repo.

> Coolify cho đổi proxy sang **Caddy** trong Server → Proxy. Cơ chế cấp chứng
> chỉ tương đương, nhưng bộ Docker label để định tuyến thì khác — xem mục 5.2.

Ba điều kiện phải đủ, thiếu một là không cấp được chứng chỉ:

1. **DNS đã trỏ đúng** — bản ghi A/AAAA của domain chỉ về IP VPS, và đã lan
   truyền xong (`dig +short <domain>`).
2. **Cổng 80 và 443 mở ra Internet.** Cổng 80 nghe có vẻ thừa khi đã có 443,
   nhưng ACME HTTP-01 challenge đi qua nó — đóng 80 là không xin được chứng chỉ.
3. **Gõ domain kèm `https://` trong Coolify.** Đây là chỗ hay sai nhất: Coolify
   quyết định có cấp SSL hay không dựa vào scheme bạn nhập. Gõ
   `http://domain.com` thì nó phục vụ HTTP trần và không xin chứng chỉ nào cả.

Đứng sau Cloudflare proxy (mây cam) thì HTTP-01 challenge không tới được máy
chủ. Xử lý: bật SSL mode **Full (strict)** ở Cloudflare, hoặc chuyển Coolify
sang DNS challenge.

### Ba chỗ trong dự án phụ thuộc HTTPS thật sự chạy

**1. Cookie phiên có cờ `secure`** ([session.ts:95](../src/lib/session.ts#L95)):

```ts
secure: isProduction;
```

Trên production, trình duyệt **chỉ gửi cookie này qua HTTPS**. Nếu domain đang
chạy HTTP trần, triệu chứng rất khó đoán: đăng nhập báo thành công, redirect
đúng, nhưng vào trang nào cũng thấy như chưa đăng nhập — vì cookie được set mà
không bao giờ được gửi lại.

**2. `NEXT_PUBLIC_APP_URL` phải là `https://`.** Nó là gốc của link trong email
xác thực/đặt lại mật khẩu, và là gốc của redirect URI OAuth. Để `http://` thì
thư gửi đi mang link http (không rút lại được), còn OAuth trả
`redirect_uri_mismatch`. `REALTIME_CORS_ORIGIN` cũng vậy.

**3. CSP có `upgrade-insecure-requests` ở production**
([proxy.ts:39](../src/proxy.ts#L39)) — trình duyệt tự nâng mọi request con lên
HTTPS. Vô hại khi HTTPS chạy đúng; nhưng nếu bạn nhúng tài nguyên chỉ có HTTP
thì chúng sẽ hỏng.

### ⚠️ HSTS — cái bẫy có thể khoá bạn khỏi domain

`next.config.mjs` gửi header:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Nghĩa là: trình duyệt nào từng nhận header này sẽ **từ chối kết nối HTTP tới
domain đó trong 2 năm**, và `includeSubDomains` áp cho **mọi subdomain** — kể
cả subdomain bạn chưa dựng.

Hai tình huống thường gặp:

- Test trên domain thật trước khi có chứng chỉ → trình duyệt của bạn ghi nhớ
  HSTS → sau đó không vào được bằng HTTP nữa dù muốn. Gỡ bằng cách xoá thủ công
  trong `chrome://net-internals/#hsts`.
- Có một subdomain nội bộ chạy HTTP (ví dụ `metabase.domain.com`) → nó cũng bị
  chặn theo, vì `includeSubDomains`.

Từ khoá `preload` chỉ là **lời đề nghị** — nó chỉ có hiệu lực nếu bạn tự nộp
domain lên hstspreload.org. Đừng nộp cho tới khi chắc chắn mọi subdomain hiện
tại **và tương lai** đều có HTTPS: rút khỏi danh sách preload mất hàng tháng.

Chỉ dùng HTTPS cho một môi trường tạm? Hạ `max-age` xuống nhỏ (ví dụ `300`)
trong `next.config.mjs` trước khi deploy, rồi nâng lại khi đã ổn định.

---

## 5. Ba chỗ dễ sai nhất

### 5.1. `NEXT_PUBLIC_APP_URL` phải là **build variable**

Đây là lỗi tốn thời gian nhất, vì nó **không báo lỗi gì cả**.

Mọi biến bắt đầu bằng `NEXT_PUBLIC_` được Next.js **nhúng thẳng vào bundle
JavaScript lúc BUILD**, không phải đọc lúc chạy. Chỉ đặt nó ở phần runtime
env thì mã phía trình duyệt nhận giá trị rỗng, trong khi mã phía máy chủ vẫn
thấy đúng — nên app trông như chạy bình thường cho tới khi một tính năng phía
client cần tới nó.

Trong Coolify, khi thêm biến này nhớ bật tuỳ chọn **Build Variable** (hoặc
"Available at buildtime" — tên tuỳ phiên bản).

### 5.2. Định tuyến WebSocket sang `realtime`

Mặc định Coolify trỏ toàn bộ domain vào **một** service. Với dự án này phải
tách:

| Đường dẫn      | Service    | Cổng |
| -------------- | ---------- | ---- |
| `/socket.io/*` | `realtime` | 3002 |
| còn lại        | `web`      | 3000 |

Trong Coolify, đặt domain cho service `web` như bình thường, rồi thêm cho
service `realtime` một domain **kèm path**:

```
https://<domain-that>/socket.io
```

Không làm bước này thì realtime chạy, container xanh, log sạch — nhưng client
từ Internet không có đường nào tới nó. Triệu chứng phía người dùng chỉ là
"WebSocket không kết nối", không kèm manh mối nào.

#### Cách chắc chắn hơn: viết label Traefik

Coolify không tự nghĩ ra luật định tuyến — nó **gắn Docker label lên container**,
rồi Traefik đọc label đó qua Docker socket và tự dựng route. Nghĩa là bạn viết
label thẳng vào `docker-compose.yml` cũng có tác dụng y hệt bấm trong giao diện,
và cách này không phụ thuộc phiên bản UI:

```yaml
realtime:
  labels:
    - traefik.enable=true
    - traefik.http.routers.realtime.rule=Host(`domain-cua-ban.com`) && PathPrefix(`/socket.io`)
    - traefik.http.routers.realtime.entrypoints=https
    - traefik.http.routers.realtime.tls=true
    - traefik.http.routers.realtime.tls.certresolver=letsencrypt
    - traefik.http.services.realtime.loadbalancer.server.port=3002
```

Vì sao luật này thắng luật của `web` dù cả hai cùng khớp `Host(...)`: Traefik
tự xếp độ ưu tiên **theo độ dài luật**. `Host() && PathPrefix()` dài hơn
`Host()` nên được xét trước — không cần khai báo `priority` thủ công.

⚠️ Hai chỗ cần đối chiếu với máy chủ của bạn:

- Tên `certresolver` (`letsencrypt` ở trên) phải trùng tên Coolify đặt trong
  cấu hình Traefik. Xem file cấu hình proxy trong Coolify để lấy đúng tên.
- Nếu bạn **đã đổi proxy sang Caddy** trong Server → Proxy thì label Traefik vô
  tác dụng — Caddy dùng bộ label riêng (`caddy`, `caddy.reverse_proxy`).

Cách thay thế đơn giản nhất, không đụng tới label: cấp cho realtime một
**subdomain riêng** (`ws.<domain>`) trong Coolify như một domain bình thường,
rồi trỏ client Socket.IO vào đó. Đổi lại là phải thêm một bản ghi DNS và cấu
hình phía client.

### 5.3. `SESSION_SECRET` phải giống nhau ở cả hai service

`web` cấp token, `realtime` verify token đó. Lệch một ký tự là mọi kết nối
WebSocket bị từ chối với thông báo `unauthorized` chung chung, không nói lý do.

`docker-compose.yml` đã khai báo tường minh `SESSION_SECRET` cho **cả hai**
service, và dùng cú pháp `${SESSION_SECRET:?...}` — nghĩa là compose **dừng
ngay** kèm tên biến nếu thiếu, thay vì dựng container rồi mới chết lúc khởi
động. Bạn chỉ cần khai báo biến này một lần ở cấp resource.

---

## 6. Deploy và seed tài khoản admin

Bấm **Deploy**. Xong lần đầu thì tạo tài khoản quản trị — chạy một lần:

```bash
docker compose run --rm tools pnpm db:seed:prod
```

Chạy lệnh này ở đâu:

- **Coolify UI**: mục **Terminal / Execute Command** của resource.
- **Hoặc SSH vào VPS**, `cd` tới thư mục Coolify checkout repo rồi chạy.

Service `tools` nằm sau profile `tools` nên nó **không bao giờ tự chạy** cùng
`docker compose up` — chỉ chạy khi bạn gọi tên nó.

⚠️ Seed chạy lại nhiều lần được và **không ghi đè** mật khẩu admin đã tồn tại.

---

## 7. Dọn token định kỳ

Hai bảng `refresh_tokens` và `verification_tokens` **chỉ tăng**: mỗi lần đăng
nhập trên điện thoại thêm một dòng, mỗi lần bấm "quên mật khẩu" thêm một dòng —
kể cả khi người dùng không bao giờ mở email. Không có gì tự xoá chúng.

Coolify có sẵn **Scheduled Tasks**. Thêm một task:

| Trường    | Giá trị                         |
| --------- | ------------------------------- |
| Command   | `pnpm db:purge`                 |
| Container | `tools` (hoặc `web`)            |
| Frequency | `0 3 * * *` (3h sáng hằng ngày) |

Không có Scheduled Tasks thì dùng cron của VPS:

```
0 3 * * * cd /data/coolify/applications/<id> && docker compose run --rm tools pnpm db:purge
```

---

## 8. Kiểm tra sau khi deploy

Chạy đủ 6 lệnh. Mỗi lệnh bắt một lỗi khác nhau, và tất cả đều thuộc loại **im
lặng** — không tự lộ ra cho tới khi có người dùng thật gặp phải.

```bash
# 1. Web sống và nối được database
curl -s https://<domain>/api/health
# mong đợi: {"status":"ok","database":"up",...}

# 2. API trả JSON, không phải HTML chuyển hướng
curl -s -i https://<domain>/api/v1/users | head -3
# mong đợi: HTTP 401 + content-type: application/json

# 3. WebSocket có đường vào
curl -s -i "https://<domain>/socket.io/?EIO=4&transport=polling" | head -3
# mong đợi: HTTP 200. Nếu ra 404 → chưa định tuyến, xem mục 5.2

# 4. HTTPS và header bảo mật
curl -sI https://<domain> | grep -i "strict-transport\|content-security"

# 5. Đăng nhập được bằng tài khoản admin vừa seed (mở trình duyệt vào /login)

# 6. Rate limit đang chạy
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://<domain>/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"identifier":"khong-ton-tai@example.com","password":"sai"}'
done; echo
# mong đợi: 401 401 401 401 401 429
```

---

## 9. Sao lưu database

Coolify có backup tự động cho database nó quản lý — **nhưng chỉ khi Postgres
được tạo dưới dạng Coolify Database resource.** Ở đây Postgres nằm trong
`docker-compose.yml`, nên nó là container thường và **Coolify không backup nó**.

Hai lựa chọn:

**A. Tách Postgres ra thành Coolify Database resource** (khuyến nghị cho
production thật). Lúc đó bỏ service `postgres` khỏi compose và điền
`DATABASE_URL` trỏ tới database Coolify quản lý. Đổi lại: có backup tự động,
có giao diện quản lý, khôi phục bằng vài cú bấm.

**B. Giữ nguyên và tự đặt cron dump:**

```
0 2 * * * docker exec chotsan_postgres pg_dump -U postgres chotsan | gzip > /var/backups/db-$(date +\%F).sql.gz
```

⚠️ Dump nằm cùng máy với database thì **không phải backup** — nó chỉ cứu được
khi xoá nhầm bảng, không cứu được khi mất VPS. Đẩy lên object storage và **thử
khôi phục ít nhất một lần**. Chi tiết: [disaster-recovery.md](disaster-recovery.md).

---

## 10. Sự cố thường gặp

| Triệu chứng                                                          | Nguyên nhân                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Container chết ngay, log ghi "Cấu hình môi trường không hợp lệ"      | Thiếu biến bắt buộc. Log có ghi rõ tên biến.                                                              |
| `/api/health` trả 503                                                | `web` sống nhưng không nối được `postgres`. Kiểm tra `POSTGRES_PASSWORD` khớp giữa hai service.           |
| App chạy nhưng bảng chưa tồn tại                                     | `migrate` không chạy — thường do chọn nhầm build pack Nixpacks/Dockerfile.                                |
| WebSocket không kết nối, container `realtime` vẫn xanh               | Chưa định tuyến `/socket.io/*` (mục 5.2).                                                                 |
| WebSocket bị chặn bởi CORS                                           | `REALTIME_CORS_ORIGIN` chưa trỏ đúng domain thật.                                                         |
| Kết nối WebSocket bị từ chối `unauthorized`                          | `SESSION_SECRET` lệch giữa `web` và `realtime`.                                                           |
| Deploy dự án thứ 2 báo `port is already allocated`                   | Hai dự án cùng dùng `APP_PORT`/`POSTGRES_PORT`/`REALTIME_PORT`. Đặt bộ cổng riêng cho từng dự án (mục 2). |
| Cổng 80/443 bị chiếm, Coolify không cấp được SSL                     | Có Caddy/nginx cài tay từ trước đang giữ cổng. Gỡ đi — Coolify có proxy riêng.                            |
| Tính năng phía client thiếu URL app                                  | `NEXT_PUBLIC_APP_URL` chưa bật **Build Variable** (mục 5.1).                                              |
| Gửi email ném lỗi                                                    | Thiếu `NEXT_PUBLIC_APP_URL`, hoặc chưa gọi `setMailer()` với nhà cung cấp thật.                           |
| OAuth trả `redirect_uri_mismatch`                                    | Redirect URI phải là `<APP_URL>/api/v1/auth/oauth/<provider>/callback` — chú ý phần `/v1`.                |
| Đăng nhập xong bị đá ra ngay                                         | `SESSION_SECRET` vừa đổi → mọi cookie cũ thành không hợp lệ.                                              |
| Đăng nhập báo thành công nhưng vào trang nào cũng như chưa đăng nhập | Domain đang chạy HTTP trần. Cookie phiên có cờ `secure` nên trình duyệt không gửi lại (mục 4).            |
| Trình duyệt không cho vào bằng HTTP dù muốn                          | HSTS đã ghi nhớ. Xoá trong `chrome://net-internals/#hsts` (mục 4).                                        |

Thêm các bẫy đã gặp thật: [GOTCHAS.md](GOTCHAS.md).

---

## 11. So với hai cách deploy còn lại

|                    | Coolify                          | Docker Compose tay           | systemd / PM2             |
| ------------------ | -------------------------------- | ---------------------------- | ------------------------- |
| Dựng lần đầu       | Nhanh nhất                       | Trung bình                   | Chậm nhất                 |
| Tự cấp SSL         | ✓                                | Tự cấu hình Caddy            | Tự cấu hình Caddy         |
| Deploy khi push    | ✓ tự động                        | `./scripts/deploy-docker.sh` | `./scripts/deploy-vps.sh` |
| Giao diện xem log  | ✓                                | `docker compose logs`        | `journalctl`              |
| Backup database    | ✓ nếu tách DB resource           | tự làm                       | tự làm                    |
| RAM tốn thêm       | Cao nhất (Coolify tự chiếm ~1GB) | Trung bình                   | Thấp nhất                 |
| Khi hỏng thì debug | Qua nhiều lớp                    | Trực tiếp                    | Trực tiếp                 |

**Chọn Coolify khi** chạy nhiều dự án trên một VPS và muốn một dashboard chung.
**Đừng chọn** khi VPS chỉ 1–2GB RAM — riêng Coolify đã ăn gần hết.

Hai cách còn lại: [DEPLOY_VPS.md](DEPLOY_VPS.md).
