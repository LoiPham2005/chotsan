---
name: chotsan-project
description: Bản đồ toàn bộ dự án ChốtSân (repo sports_booking_v2) — sản phẩm và vai trò, stack và phiên bản, cấu trúc thư mục, luật vàng không được phá, mô hình dữ liệu 38 model, luồng tìm sân → chọn khung 30 phút → giữ chỗ → thanh toán gộp → chủ sân duyệt → hoá đơn hoa hồng, xác thực và phân quyền theo sân, giao diện và route, hạ tầng (queue, worker, realtime, deploy), kiểm thử (unit, e2e, db:check-conflict), quy trình migration an toàn, bẫy đã gặp và quyết định đã chốt. Đọc TRƯỚC khi làm bất kỳ việc gì trong repo này — sửa lỗi, thêm tính năng, trả lời câu hỏi về dự án, review — kể cả việc trông nhỏ.
---

# ChốtSân — hiểu dự án trước khi chạm vào mã

**ChốtSân** là nền tảng đặt sân thể thao ở Việt Nam (cầu lông, bóng đá, pickleball, tennis, bóng
rổ…). Ba nhóm người dùng:

| Ai                          | Làm gì                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Khách**                   | Tìm sân, xem lịch trống theo khung 30 phút, chọn nhiều ô/nhiều sân, đăng nhập, giữ chỗ, chuyển khoản theo QR, xem/huỷ/đánh giá lượt đặt |
| **Chủ sân / nhân viên sân** | Lịch sân theo ngày, duyệt tiền chuyển khoản, nhận sân, huỷ hộ, sân con + bảng giá, nhân sự + quyền, cài đặt sân, doanh thu              |
| **Quản trị nền tảng**       | Duyệt cơ sở mới, đối soát hoá đơn hoa hồng, người dùng, vai trò                                                                         |

Repo: `github.com/LoiPham2005/chotsan`, thư mục `/Users/loipd/personal/sports_booking_v2`. Dựng lại
từ bản cũ `sports_booking` (v1, NestJS + Next) trên bộ khung `nextjs_base` (đã chép vào, không phải
submodule) — nên README và nửa sau CLAUDE.md nói về BỘ KHUNG, có chỗ lỗi thời (xem
`references/gotchas-decisions.md` mục C).

**Giao tiếp với người dùng bằng tiếng Việt.** Nói nguyên nhân kèm bằng chứng; việc gì tự làm được
thì tự làm, việc họ phải làm (vd khởi động lại `pnpm dev`) nói thẳng một câu.

---

## Stack — phiên bản MỚI hơn kiến thức mặc định

| Thứ        | Phiên bản / ghi chú                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js    | **16.3.1**, App Router, Turbopack. API khác bản cũ (`proxy.ts` thay middleware, `params`/`searchParams` là Promise, `next/image` dùng `preload` thay `priority`…). **Đọc `node_modules/next/dist/docs/` trước khi dùng API Next** (AGENTS.md). |
| React      | 19 — `useActionState`, `useFormStatus`; lint React Compiler cấm `setState` đồng bộ trong effect và đọc đồng hồ khi render                                                                                                                      |
| Prisma     | **7.9.1**, generator `prisma-client-js`, `@prisma/adapter-pg`, cấu hình ở `prisma.config.ts`. Lỗi trùng khoá có hình dạng mới (GOTCHAS #10)                                                                                                    |
| Database   | PostgreSQL trên **Neon** (một database dev dùng chung cho `pnpm dev`, e2e, script) — `pg_trgm`, `btree_gist`                                                                                                                                   |
| CSS        | Tailwind **v4** + token riêng trong `src/app/globals.css`                                                                                                                                                                                      |
| Khác       | Zod 4, jose, `@node-rs/argon2`, `@simplewebauthn` v14, BullMQ + Redis (tuỳ chọn), socket.io (realtime), Vitest 4, Playwright                                                                                                                   |
| Gói / Node | **pnpm** (không dùng npm), Node 24                                                                                                                                                                                                             |

---

## Bản đồ thư mục

```
src/
  proxy.ts                  CSP có nonce + chặn trang theo đăng nhập (KHÔNG chạy trên /api)
  instrumentation.ts        onRequestError — nhắc khởi động lại dev khi Prisma Client cũ
  app/
    page.tsx, layout.tsx    trang chủ; layout gốc (Header, Footer, TopProgressBar)
    (public)/               /venues (tìm sân), /venues/[slug] (chi tiết + lưới đặt), /bookings/[code] (thanh toán)
    (account)/              /account/bookings (lượt đặt của tôi, huỷ, đánh giá)
    (manage)/               /manage, /manage/[venueId]/{payments,courts,staff,settings,revenue}
    (admin)/                /venue-approvals, /invoices, /users, /roles
    (auth)/                 /login, /register, /forgot-password, /reset-password, /verify-email, /confirm-email-change
    security/, sessions/    2FA + passkey; thiết bị đăng nhập (trang của bộ khung)
    api/v1/**               REST cho MOBILE (Bearer token) — auth, users, roles, notifications, devices, files…
    api/dev/quick-login     đăng nhập nhanh — 404 ở production
    logout-action.ts        đăng xuất WEB (Server Action)
  components/{booking,venue,manage,account,admin,layout,ui}
  services/*.service.ts     NƠI DUY NHẤT gọi Prisma; mỗi service có *.test.ts cạnh nó
  lib/                      auth, session, permissions, define-action, slots, date, pricing, vietqr, errors, prisma-errors, rate-limit, queue, storage…
  jobs/                     job nền (types + handlers) — chạy bởi worker/
  schemas/                  Zod cho API (auth, user, role, notification…)
prisma/                     schema.prisma, migrations/, seed.ts + seeds/
worker/  realtime/          tiến trình thứ hai và thứ ba (job nền; WebSocket)
e2e/                        Playwright
scripts/                    check-db-constraints.ts (db:check-conflict), purge-expired, deploy
docs/                       TIEN_DO (tiến độ + quyết định), GOTCHAS (bẫy), THIET_KE_LAI, KE_HOACH_REFACTOR, RBAC, DEPLOY…
design/                     bản vẽ giao diện (.dc.html, chotsan-giao-dien.html)
public/demo/venues/         12 ảnh sân mẫu CC0
.claude/skills/             chotsan-project (tệp này), chotsan-thiet-ke (hệ thiết kế)
```

---

## Luật vàng — phá một điều là lỗi thật đã từng xảy ra

**Kiến trúc**

1. Route/Server Action → **service** → Prisma. Không truy vấn database trong page/action/route.
2. Mọi Server Action bọc bằng wrapper của `src/lib/define-action.ts` (`defineAction` /
   `defineAuthedAction` / `defineVenueAction` / `definePublicAction`). Không tự viết
   `if (!session) return`.
3. Kiểm quyền độc lập ở MỌI lớp: proxy và layout chỉ là UX; page tự `requirePermission`/
   `requireVenueAccess`; **action/route tự kiểm lại**. Trang, Server Action và mọi tài nguyên theo
   sân/của người khác: không đủ quyền → **404** (403 xác nhận "có thật"). Riêng REST API thiếu quyền
   CHUNG trả 403 (`requireApiPermission`) để client phân biệt với "đăng nhập lại".
4. Quyền theo sân luôn là `canOnVenue(userId, permission, venueId)`.
5. **Id lấy từ FORM trong action theo sân phải được service lọc theo `ctx.venueId` ngay trong câu
   truy vấn**; lệch sân → NOT_FOUND (GOTCHAS #19).
6. Web và mobile dùng chung service, KHÔNG chung endpoint (web: Server Action + cookie; mobile:
   `/api/v1` + Bearer).
7. `redirect()` luôn NGOÀI `try/catch`. Route handler chuyển hướng người dùng dùng
   `redirectRelative()`. Sau đăng nhập: `?next=` rồi `landingPathFor()` — không bao giờ `/users`.

**Nghiệp vụ và tiền**

8. Khung **30 phút**; mọi ngày giờ theo **Asia/Ho_Chi_Minh** qua `src/lib/date.ts`/`slots.ts` — không
   tự `new Date(...).getHours()`.
9. Giá do SERVICE tính (`availability.quote*`); form KHÔNG BAO GIỜ gửi số tiền.
10. Chống trùng chỗ là ràng buộc `EXCLUDE` trong database; service bắt `isExclusionViolation` →
    `SlotTakenError`. Không bỏ nhánh bắt lỗi vì "đã kiểm ở trên".
11. Một lượt đặt chỉ một giao dịch sống; webhook chống chạy lại bằng unique `(provider, externalEventId)`;
    lệch tiền thì DỪNG.
12. Đúng-sai không phụ thuộc worker: chỗ giữ quá hạn không chiếm chỗ; khai chuyển khoản xoá hạn giữ chỗ.
    (Nhưng job theo lịch — huỷ giao dịch PENDING quá hạn, xuất/đánh dấu hoá đơn — CHỈ chạy khi worker
    chạy; `QUEUE_ENABLED=0` hoặc thiếu Redis là không có lịch nào.)
13. Nhiều lượt một lần đặt = một lần thanh toán (`checkoutCode`) — màn thanh toán, QR, duyệt đều theo nhóm.

**Dữ liệu**

14. **KHÔNG `prisma migrate dev` / `pnpm db:migrate` / `db:push`** — chúng xoá index/ràng buộc viết
    tay. Quy trình: `pnpm db:migrate:diff` → đọc, xoá mọi `DROP` đụng ràng buộc viết tay → lưu vào
    `prisma/migrations/<timestamp>_<english_name>/migration.sql` → `pnpm db:deploy` →
    `pnpm db:generate` → `pnpm db:check-conflict` → khởi động lại `pnpm dev`.
15. Cột và ràng buộc `snake_case` qua `@map`; đổi tên cột bằng `RENAME COLUMN`, không DROP+ADD.
16. Bắt lỗi Prisma chỉ bằng `isUniqueViolation`/`isExclusionViolation` (`src/lib/prisma-errors.ts`).

**Mã và giao diện**

17. Mã tiếng Anh, chữ tiếng Việt có dấu. **Không bao giờ đổi tên hàng loạt bằng regex.**
18. Nút và ô nhập dùng `<Button>`/`<Input>` (`components/ui`); màu/bóng/bo góc dùng token
    (`text-content`, `bg-surface`, `bg-brand`, `shadow-nang-1`, `rounded-token-lg`…). Đọc skill
    `chotsan-thiet-ke` trước khi viết giao diện. Khung cuộn trong flex/grid cần `min-w-0`.
19. Không đọc `Date.now()` khi render — tính ở service. Hằng số dùng chung giữa server/client đặt
    ở module thường, không trong tệp `"use client"`.
20. Tối giản: không tạo thư mục/pattern/dependency "để sau dùng".

**Lỗ hổng bảo mật đang MỞ (17/09/2026, đã đối chiếu mã — chi tiết `references/auth-rbac.md` §14)**

Đừng chép lại các mẫu sai này sang mã mới; chạm vùng đó thì báo người dùng:

- `roleService.create/update/remove` và `POST /api/v1/users` được gọi **không truyền `actorId`** →
  chốt `Role.level` bị bỏ qua → ADMIN tự tick quyền của SUPER_ADMIN cho vai trò ADMIN, hoặc tạo tài
  khoản SUPER_ADMIN. Mã mới gọi service có chốt level phải truyền `{ actorId }`.
- Phiên web không thu hồi được: `isTokenStillValid` không ai gọi; khoá (BANNED) hay đổi mật khẩu
  không đá cookie cũ (sống tới 7 ngày); `permissionService` không lọc `status`.
- OAuth gắn vào tài khoản có sẵn theo email mà không kiểm `emailVerifiedAt` (đăng ký không bắt xác
  thực email) → chiếm trước tài khoản; OAuth cũng bỏ qua TOTP.
- `safeRedirectPath` chỉ chặn `//` → nghi `/\evil.com` lọt (open redirect).
- Nút Khoá/Mở khoá ở `/users` luôn báo "Trạng thái không hợp lệ" (parse sai schema).

---

## Quy trình làm một việc

1. Đọc reference liên quan bên dưới + mã thật của chỗ sắp sửa (mã là nguồn sự thật, tài liệu có thể lệch).
2. Lỗi người dùng báo: tái hiện trên môi trường của họ (`http://192.168.1.119:3000`) hoặc đọc log
   họ dán; tìm nguyên nhân gốc, không vá triệu chứng. Kiểm luôn các chỗ cùng loại lỗi.
3. Sửa service + unit test → action/route → giao diện.
4. Kiểm theo thang ở `references/testing-workflow.md`: `pnpm check`; e2e nếu chạm form/luồng;
   `pnpm db:check-conflict` nếu chạm ràng buộc/tiền/giữ chỗ; chụp màn hình nếu chạm giao diện.
5. Đổi schema: nhớ khởi động lại `pnpm dev` (người dùng chạy nó trong terminal của họ).
6. Cập nhật `docs/TIEN_DO.md` / `docs/GOTCHAS.md` / skill này khi có quyết định, bẫy, hay kiến thức nền mới.
7. Báo cáo bằng tiếng Việt. Không tự commit khi chưa được bảo.

---

## Tài liệu tham chiếu — đọc tệp nào khi nào

| Tệp                               | Đọc khi                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references/architecture.md`      | Chạm proxy/CSP, env, queue/worker/realtime, API v1 cho mobile, rate limit, storage, email/SMS, deploy                                                                                                 |
| `references/auth-rbac.md`         | Đăng nhập/đăng ký/2FA/passkey/OAuth, phiên web vs mobile, 38 quyền + vai trò, quyền theo sân, wrapper Server Action, rate limit, audit, REST auth/users/roles, biến môi trường auth                   |
| `references/data-model.md`        | Đọc/sửa `schema.prisma`, viết migration, ràng buộc viết tay, seed                                                                                                                                     |
| `references/booking-payment.md`   | Lịch trống, giá, giữ chỗ, checkout gộp, thanh toán, duyệt tiền, huỷ/đổi giờ, hoá đơn hoa hồng, đánh giá, doanh thu                                                                                    |
| `references/ui-routes.md`         | Thêm/sửa trang, component, form + action, bản đồ route, token thiết kế                                                                                                                                |
| `references/testing-workflow.md`  | Viết/chạy test, e2e, `db:check-conflict`, làm việc trên môi trường dev của người dùng, kết thúc việc                                                                                                  |
| `references/gotchas-decisions.md` | Trước khi đề xuất làm khác đi; debug lỗi trông quen; biết tài liệu nào lỗi thời                                                                                                                       |
| Danh sách nghi lỗi ĐÃ BIẾT        | Trước khi sửa lỗi hay khi thấy hành vi lạ: `booking-payment.md` §14, `auth-rbac.md` §14, `ui-routes.md` §12, `architecture.md` §9, `gotchas-decisions.md` §E — có thể đã được ghi kèm vị trí trong mã |
| `docs/GOTCHAS.md`                 | Chi tiết từng bẫy kèm log thật                                                                                                                                                                        |
| `.claude/skills/chotsan-thiet-ke` | Trước khi viết bất kỳ giao diện nào                                                                                                                                                                   |

---

## Lệnh hay dùng

```bash
pnpm dev                     # http://localhost:3000 — người dùng mở qua http://192.168.1.119:3000
pnpm check                   # typecheck → lint → format:check → test (bắt buộc trước khi coi là xong)
pnpm exec playwright test    # e2e trên bản build production, cổng 3100
pnpm db:check-conflict       # chống trùng chỗ + trùng tiền trên database thật
pnpm db:migrate:diff         # sinh SQL migration (ĐỌC và LỌC trước khi dùng)
pnpm db:deploy               # áp migration
pnpm db:generate             # sinh lại Prisma Client → rồi khởi động lại pnpm dev
pnpm db:seed                 # dữ liệu mẫu, chạy lại an toàn
pnpm worker:dev              # job nền (cron nhả chỗ, hoá đơn…) — cần REDIS_URL khi QUEUE_ENABLED=1
pnpm realtime:dev            # WebSocket, cổng 3002
```

Tài khoản mẫu (mật khẩu `matkhau123`): `admin@dev.local` (ADMIN, không phải SUPER_ADMIN — SUPER_ADMIN là `ADMIN_EMAIL` trong env), `chusan@dev.local` (chủ 3 cơ sở
mẫu), `nhanvien@dev.local` (nhân viên, có `payment:confirm`), `user@dev.local` (khách). Cơ sở mẫu:
`cau-long-thanh-cong` (10 sân, sân cuối tắt), `san-bong-my-dinh` (4 sân), `pickleball-quan-7` (6 sân).
