import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { z } from "zod";
import { verifySession, type SessionPayload } from "@/lib/session";
import { logger } from "@/lib/logger";
import { securityStampService } from "@/services/security-stamp.service";
import { realtimeEnv } from "./env";

/**
 * Máy chủ realtime — tiến trình RIÊNG, không nằm trong Next.js.
 *
 * Vì sao phải tách: App Router là mô hình request/response, không giữ được kết
 * nối WebSocket lâu dài. Nhét socket vào Next bằng custom server thì phá
 * `output: "standalone"`, và mỗi lần deploy web là rớt sạch kết nối đang mở.
 *
 * Vì sao KHÔNG cần NestJS: tiến trình này chỉ làm một việc, và nó dùng lại
 * `verifySession` cùng tầng service của app chính — web, mobile và socket chung
 * đúng một token, một tầng nghiệp vụ. Khi nào nó phình ra nhiều gateway, queue
 * consumer và cron thì mới đáng cân nhắc framework có DI.
 */

type SocketData = { session: SessionPayload };
type AppSocket = Socket<Record<string, never>, Record<string, never>, never, SocketData>;

/** Mỗi người dùng một "phòng" riêng, để phát tin tới mọi thiết bị của họ. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Payload của `ping:user` — dữ liệu từ client, KHÔNG tin được.
 *
 * Trước đây handler đọc thẳng `payload.toUserId`: một client đã đăng nhập gửi
 * `null` là ném TypeError trong listener — không ai bắt, tiến trình realtime
 * chết, mọi người đang online rớt kết nối. Có trần độ dài để một tin không thể
 * nặng vài MB rồi bị phát lại tới mọi thiết bị của người nhận.
 */
const pingUserSchema = z.object({
  toUserId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(2000),
});

/** Tối đa 10 tin mỗi 10 giây trên MỘT socket — thừa cho người gõ, chặn script bơm tin. */
export const PING_USER_RATE_LIMIT = { limit: 10, windowMs: 10_000 } as const;

/**
 * Giới hạn tần suất cửa sổ cố định, đếm trong RAM của MỘT socket.
 *
 * Đếm theo socket chứ không theo người dùng: không cần Redis, tự dọn khi socket
 * đóng. Mở thêm socket để lách vẫn phải qua bắt tay xác thực — và cái giá đó là
 * thứ giới hạn thật.
 */
export function createSocketRateLimiter(
  options: { limit: number; windowMs: number },
  now: () => number = Date.now,
): () => boolean {
  let windowStart = Number.NEGATIVE_INFINITY;
  let count = 0;

  return () => {
    const current = now();
    if (current - windowStart >= options.windowMs) {
      windowStart = current;
      count = 0;
    }
    count += 1;
    return count <= options.limit;
  };
}

export type RealtimeHandle = {
  port: number;
  stop: () => Promise<void>;
};

export async function startRealtime(): Promise<RealtimeHandle> {
  const httpServer: HttpServer = createServer((req, res) => {
    // Health check cho Docker/systemd. Một endpoint thì không cần framework HTTP.
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connections: io.engine.clientsCount }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server<Record<string, never>, Record<string, never>, never, SocketData>(
    httpServer,
    {
      cors: {
        origin: realtimeEnv.REALTIME_CORS_ORIGIN.split(",").map((o) => o.trim()),
        credentials: true,
      },
      // Mạng rớt rồi quay lại trong 2 phút thì nối tiếp phiên cũ thay vì dựng
      // phiên mới — quan trọng với mobile, nơi mạng chập chờn liên tục.
      //
      // `skipMiddlewares: false`: mặc định socket.io BỎ QUA middleware khi phục
      // hồi được phiên, tức là bỏ qua luôn bước xác thực bên dưới — tài khoản
      // vừa bị khoá chỉ cần rớt mạng rồi nối lại là vào được.
      connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: false },
    },
  );

  const redisClients = await attachRedisAdapter(io);

  /**
   * Xác thực NGAY Ở HANDSHAKE, không phải sau khi đã nối.
   *
   * Cho nối trước rồi mới kiểm tra nghĩa là kẻ tấn công vẫn giữ được kết nối mở
   * và tiêu tài nguyên máy chủ. Ở đây token sai là từ chối bắt tay luôn.
   *
   * Chữ ký đúng CHƯA đủ — cùng luật với `getSession()` (web) và
   * `getApiSession()` (API): tài khoản bị khoá, bị xoá hay đã đổi mật khẩu sau
   * lúc cấp token thì token đó bị từ chối. Thiếu bước này, socket là cửa sau
   * cho phiên đã thu hồi: vẫn nhận tin tới khi token hết hạn. Vì vậy tiến trình
   * này cần `DATABASE_URL` (và nên có `REDIS_URL` để dùng chung ảnh phiên).
   *
   * Giới hạn: chỉ kiểm LÚC NỐI (kể cả nối lại nhờ phục hồi phiên — xem
   * `skipMiddlewares` ở trên). Socket đang mở trước khi bị thu hồi vẫn sống tới
   * khi rớt mạng hoặc máy chủ khởi động lại.
   */
  // socket.io khai báo middleware trả về `void`, nên không await được hàm async
  // truyền thẳng vào. Bọc lại để lỗi trong promise vẫn tới được `next()` thay vì
  // thành unhandled rejection và treo handshake vô thời hạn.
  io.use((socket, next) => {
    void (async () => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const session = await verifySession(token);

      if (!session || !(await securityStampService.isTokenStillValid(session.sub, session.iat))) {
        // Không nói rõ vì sao (thiếu token / sai chữ ký / hết hạn) — chi tiết
        // đó chỉ có ích cho người đang dò.
        next(new Error("unauthorized"));
        return;
      }

      socket.data.session = session;
      next();
    })().catch(() => next(new Error("unauthorized")));
  });

  io.on("connection", (socket: AppSocket) => {
    const { sub: userId } = socket.data.session;

    void socket.join(userRoom(userId));
    logger.info("Socket connected", { userId, socketId: socket.id });

    const allowPing = createSocketRateLimiter(PING_USER_RATE_LIMIT);

    // Sự kiện mẫu: phát tin tới MỌI thiết bị của một người dùng.
    // Thay bằng logic thật của bạn — gọi service dùng chung, đừng viết truy vấn
    // database trực tiếp ở đây.
    socket.on("ping:user", (payload: unknown, ack?: unknown) => {
      // ack là cách client biết máy chủ đã nhận. Thiếu nó thì client không
      // phân biệt được "đã gửi" với "mất mạng". Đối số thứ hai do client gửi —
      // gọi nó khi nó không phải hàm là ném lỗi ngay trong listener.
      const reply = typeof ack === "function" ? (ack as (result: unknown) => void) : undefined;

      // Đếm TRƯỚC khi kiểm dữ liệu: payload rác dồn dập cũng phải tính lượt.
      if (!allowPing()) {
        reply?.({ ok: false, error: "RATE_LIMITED" });
        return;
      }

      const parsed = pingUserSchema.safeParse(payload);
      if (!parsed.success) {
        reply?.({ ok: false, error: "INVALID_PAYLOAD" });
        return;
      }

      io.to(userRoom(parsed.data.toUserId)).emit("message:new", {
        from: userId,
        text: parsed.data.text,
        at: new Date().toISOString(),
      });

      reply?.({ ok: true });
    });

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  // Loopback mặc định — xem `HOST` trong `realtime/env.ts` (Docker đặt 0.0.0.0).
  await new Promise<void>((resolve) => {
    httpServer.listen(realtimeEnv.REALTIME_PORT, realtimeEnv.HOST, resolve);
  });
  logger.info(`Realtime chạy tại http://${realtimeEnv.HOST}:${realtimeEnv.REALTIME_PORT}`);

  return {
    port: realtimeEnv.REALTIME_PORT,
    // Đóng gọn gàng: client đang mở được báo trước thay vì bị cắt ngang và phải
    // tự đoán là mất mạng.
    stop: async () => {
      await io.close();
      await Promise.all(redisClients.map((client) => client.quit()));
    },
  };
}

async function attachRedisAdapter(io: Server) {
  if (!realtimeEnv.REDIS_URL) {
    // Một instance thì không cần adapter. Nhưng từ instance thứ hai trở đi,
    // client nối vào máy A sẽ KHÔNG nhận được tin phát từ máy B — im lặng,
    // không báo lỗi gì. Nên phải cảnh báo rõ ở đây.
    logger.warn(
      "REDIS_URL chưa set — chạy một instance thì được, nhưng scale ngang sẽ mất tin giữa các instance",
    );
    return [];
  }

  const pubClient = createClient({ url: realtimeEnv.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));
  logger.info("Redis adapter đã kết nối");

  return [pubClient, subClient];
}
