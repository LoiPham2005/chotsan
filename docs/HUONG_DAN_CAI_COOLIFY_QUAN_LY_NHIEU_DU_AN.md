# Hướng dẫn cài Coolify để quản lý nhiều dự án trên 1 VPS

## Self-hosted PaaS là gì

Một lớp phần mềm cài lên VPS của chính bạn, đóng vai trò như "Heroku/Vercel mini":
bạn vẫn sở hữu và quản lý VPS, nhưng không phải tự viết script deploy, tự cấu
hình Nginx/SSL, tự quản lý Docker thủ công cho từng project.

**Cách hoạt động chung:**

1. Cài 1 lần duy nhất lên VPS (tự nó cũng chạy trong Docker)
2. Kết nối tới Git repo (GitHub/GitLab) — mỗi lần push code, hoặc qua webhook,
   nó tự động: pull code → build image → deploy → đổi traffic sang bản mới
3. Tự động cấp SSL (Let's Encrypt), tự động cấu hình reverse proxy, tự quản lý
   biến môi trường qua giao diện web
4. Có dashboard xem log, restart, rollback về version cũ chỉ bằng 1 click

## Vài công cụ phổ biến

| Công cụ      | Đặc điểm                                                                                                                  | Khi nào chọn                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Coolify**  | Giao diện đẹp, gần giống Vercel/Netlify nhất, hỗ trợ Next.js/Postgres/Redis native, cộng đồng lớn, miễn phí & mã nguồn mở | **Khuyên dùng mặc định** — VPS ≥ 2GB RAM       |
| **CapRover** | Nhẹ hơn, dùng Docker Swarm phía dưới, cấu hình qua `captain-definition` file                                              | Muốn nhẹ hơn Coolify nhưng vẫn có UI           |
| **Dokku**    | Tối giản nhất, gần giống Heroku CLI (`git push dokku main` là deploy)                                                     | VPS RAM thấp (~1GB), quen dùng terminal hơn UI |
| **Kamal**    | Không phải PaaS full UI, là CLI orchestrate Docker deploy qua SSH                                                         | Đã quen Docker Compose, chỉ muốn gọn hơn       |

Tradeoff chính của Coolify: tốn thêm ~1-2GB RAM chạy nền cho chính nó (ngoài
RAM cho các app). Nếu VPS quá yếu, cân nhắc Dokku thay thế.

## Cài đặt Coolify (chạy 1 lần)

SSH vào VPS (Ubuntu 22.04/24.04 khuyến nghị), chạy:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Script tự cài Docker (nếu chưa có) + Coolify. Mất khoảng 3-5 phút.

## Mở dashboard

Truy cập `http://<IP_VPS>:8000` từ trình duyệt → tạo tài khoản admin đầu tiên
(chỉ hỏi 1 lần lúc setup).

> ⚠️ Đảm bảo firewall/security group của VPS mở port **80, 443** (web traffic)
> và **8000** (dashboard, nên giới hạn chỉ IP của bạn truy cập được nếu có thể).

## Kết nối GitHub

Dashboard → **Sources** → **Add GitHub App** (hoặc dùng Deploy Key đơn giản
hơn nếu repo private) → cho phép Coolify đọc repo.

## Tạo project đầu tiên

- **New Project** → **New Resource** → chọn **Docker Compose** (nếu repo đã có
  sẵn `docker-compose.yml` thì Coolify dùng thẳng file này, không cần viết lại)
- Trỏ tới repo + branch cần deploy (thường là `main`)
- Điền biến môi trường (giống nội dung file `.env` ở local)
- Gắn domain, Coolify tự cấp SSL qua Let's Encrypt
- Bấm **Deploy**

## Thêm dự án thứ 2, thứ 3...

Chỉ cần lặp lại **New Resource** trỏ tới repo khác — Coolify tự cô lập network
Docker giữa các app, không đụng nhau, tất cả quản lý chung 1 dashboard.

## Áp dụng cho chính dự án này

Repo đã có sẵn `docker-compose.yml` (gồm `postgres`, `migrate`, `web`, `redis`,
`realtime`) — chọn thẳng build pack **Docker Compose**, không cần sửa gì trong
repo.

👉 **Hướng dẫn chi tiết: [DEPLOY_COOLIFY.md](DEPLOY_COOLIFY.md)** — biến môi
trường nào bắt buộc, ba chỗ dễ sai (`NEXT_PUBLIC_APP_URL` phải là build
variable, định tuyến `/socket.io/*` sang cổng 3002, `SESSION_SECRET` dùng chung),
seed tài khoản admin, cron dọn token và checklist kiểm tra sau khi deploy.
