import { z } from "zod";
import { featureFlag } from "@/lib/feature-flag";

/**
 * Biến môi trường riêng của tiến trình realtime.
 *
 * Tách khỏi `src/lib/env.ts` có chủ đích: realtime không cần ADMIN_PASSWORD hay
 * cấu hình email/OAuth, và bắt nó khai báo những thứ đó chỉ tạo ra cấu hình giả
 * để làm hài lòng bộ validate. Nó chỉ cần đúng thứ nó dùng.
 *
 * Riêng SESSION_SECRET thì BẮT BUỘC giống hệt app chính — token do web/mobile
 * cấp phải verify được ở đây, nếu lệch thì mọi kết nối đều bị từ chối.
 *
 * ⚠️ Realtime ĐỌC database: lúc bắt tay (kể cả khi socket nối lại) nó kiểm phiên
 * đã bị thu hồi chưa — đổi mật khẩu, bị khoá, bị xoá (`security-stamp.service`).
 * Nên cần `DATABASE_URL` thật, và nên có `REDIS_URL` để cache ảnh phiên dùng
 * chung giữa các tiến trình. Compose truyền tường minh.
 */
const schema = z.object({
  /**
   * Cùng biến với app (`src/lib/env.ts`). `0` = dự án này không dùng WebSocket,
   * nên `main.ts` thoát ngay thay vì mở một cổng chẳng ai gọi tới.
   *
   * Nhận `1`/`0` vì `docker-compose.yml` dùng chính biến này làm `replicas`.
   */
  REALTIME_ENABLED: featureFlag(true),

  REALTIME_PORT: z.coerce.number().int().positive().default(3002),

  /**
   * Địa chỉ lắng nghe. Mặc định CHỈ loopback: reverse proxy (Caddy) cùng máy là
   * cửa duy nhất đi vào, như web (`HOSTNAME=127.0.0.1`). Mở `0.0.0.0` trên VPS là
   * để client gọi thẳng cổng 3002, bỏ qua TLS của proxy.
   *
   * ⚠️ Trong Docker phải là `0.0.0.0`: cổng công bố của compose đi vào card mạng
   * của container, không vào loopback — Dockerfile và compose đã đặt sẵn.
   */
  HOST: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default("127.0.0.1"),
  ),

  /** Bỏ trống = chạy một instance. Bắt buộc khi scale từ 2 instance trở lên. */
  REDIS_URL: z.string().min(1).optional(),

  REALTIME_CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Cấu hình realtime không hợp lệ:\n${details}`);
}

export const realtimeEnv = parsed.data;
