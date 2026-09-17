import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Rate limiter cửa sổ cố định. Dùng Redis khi có `REDIS_URL`, RAM khi không.
 *
 * ---
 * VÌ SAO CẦN REDIS
 *
 * Đếm trong RAM đủ cho đúng MỘT container, nhưng hỏng theo hai cách khi lên thật:
 *
 *   - Chạy 2 replica → mỗi replica đếm riêng → ngưỡng thực tế nhân đôi. Kẻ dò
 *     mật khẩu chỉ cần bắn qua load balancer là được gấp N lần số lần thử.
 *   - Deploy hoặc restart → bộ đếm về 0. Đúng lúc bị dò, việc restart lại là
 *     món quà cho phía tấn công.
 *
 * ---
 * VÌ SAO VẪN GIỮ BẢN RAM
 *
 * Bắt buộc phải có Redis mới chạy được `pnpm dev` là một rào cản vô nghĩa.
 */

export type RateLimitOptions = { limit: number; windowSeconds: number };

/**
 * Ngưỡng cho từng loại thao tác, khai báo MỘT LẦN.
 *
 * Web và mobile là hai cửa vào khác nhau nhưng phải chịu chung một chính sách.
 * Rải các con số này ở từng controller thì siết ngưỡng đăng nhập mà quên một
 * chỗ là cửa còn lại vẫn mở.
 */
export const RATE_LIMITS = {
  login: { limit: 5, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  refresh: { limit: 30, windowSeconds: 300 },

  /**
   * Gửi email: siết chặt hơn hẳn. Không phải để chống dò mật khẩu, mà để hệ
   * thống không bị biến thành công cụ dội thư rác — mỗi lần gọi là một email
   * gửi tới địa chỉ do người gọi chỉ định. Chi phí nằm ở hộp thư người khác và
   * ở uy tín tên miền gửi của bạn.
   */
  passwordResetRequest: { limit: 3, windowSeconds: 900 },
  emailVerificationRequest: { limit: 3, windowSeconds: 900 },

  /**
   * Đổi/đặt lại mật khẩu. Token là 256 bit ngẫu nhiên nên không dò được, nhưng
   * mỗi lần gọi đều tốn một phép băm Argon2id — vốn cố tình ngốn bộ nhớ. Không
   * giới hạn thì chính endpoint này là đường tấn công từ chối dịch vụ rẻ nhất
   * của hệ thống.
   */
  passwordChange: { limit: 10, windowSeconds: 900 },

  /**
   * Mọi endpoint nhập mã 2FA (xác minh lúc đăng nhập, bật, tắt, cấp lại mã) —
   * ngưỡng theo IP.
   *
   * Siết chặt vì mã TOTP chỉ có 10^6 khả năng và mã khôi phục thì ít hơn nhiều
   * so với một token 256 bit. Ngưỡng này chặn MỘT IP dò nhiều lần; nhiều IP
   * cùng dò MỘT tài khoản thì do `twoFactorAccount` bên dưới chặn — hai lớp cho
   * hai kiểu tấn công khác nhau. (`VERIFICATION_MAX_ATTEMPTS` KHÔNG liên quan:
   * nó chỉ đếm trên mã OTP gửi qua SMS.)
   */
  twoFactor: { limit: 10, windowSeconds: 300 },

  /**
   * Số lần nhập mã 2FA theo TÀI KHOẢN, dùng chung cho web và API.
   *
   * Đếm mọi lần thử (không chỉ lần sai) và xoá bộ đếm khi nhập đúng: đếm bằng
   * INCR nguyên tử thì 20 request song song cũng bị tính đủ 20, còn "đọc số lần
   * sai rồi mới quyết" thì cả 20 cùng đọc thấy 0. Vượt ngưỡng là chặn cả mã
   * ĐÚNG tới hết cửa sổ — không thì kẻ dò chỉ cần đổi IP.
   */
  twoFactorAccount: { limit: 5, windowSeconds: 900 },

  /**
   * Đăng nhập/đăng ký bằng passkey.
   *
   * Rộng hơn `login` vì passkey KHÔNG dò được (chữ ký khoá công khai, không
   * có gì để đoán) — giới hạn ở đây chỉ để chống bơm request, không phải chống
   * dò thông tin đăng nhập.
   */
  passkey: { limit: 30, windowSeconds: 300 },

  /**
   * Xin mã OTP qua SMS — ngưỡng theo IP.
   *
   * Đây mới chỉ là lớp thứ nhất. Hai lớp còn lại (giãn cách và trần theo ngày
   * trên từng SỐ ĐIỆN THOẠI) nằm trong `AuthService.requestPhoneVerification`,
   * vì chỉ ở đó mới biết số điện thoại là gì.
   */
  phoneOtp: { limit: 5, windowSeconds: 900 },

  /** Xin link upload — chặn việc bơm rác vào kho lưu trữ. */
  upload: { limit: 60, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitOptions>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/**
 * Tên XÔ ĐẾM của từng luồng, dùng CHUNG cho web (Server Action) và API.
 *
 * Trước đây web đếm `login:<ip>` còn API đếm `api:login:<ip>`: cùng một kẻ dò
 * mật khẩu được gấp đôi số lần thử chỉ bằng cách luân phiên hai cửa. Khai tên
 * ở đúng một chỗ thì hai cửa không thể lệch nhau nữa.
 *
 * Tên xô KHÔNG trùng tên ngưỡng trong `RATE_LIMITS`: nhiều luồng dùng chung
 * một mức (đặt lại mật khẩu, xác thực email, đổi mật khẩu cùng 10/15 phút)
 * nhưng phải đếm riêng — người vừa đặt lại mật khẩu không được mất lượt xác
 * thực email.
 */
export const RATE_LIMIT_BUCKETS = {
  login: "login",
  register: "register",
  refresh: "refresh",
  twoFactor: "2fa",
  passkey: "passkey",
  passwordResetRequest: "password-reset-request",
  passwordReset: "password-reset",
  passwordChange: "password-change",
  emailVerify: "email-verify",
  emailVerificationRequest: "email-verification-request",
  emailChangeRequest: "email-change-request",
  emailChangeConfirm: "email-change-confirm",
  phoneOtpRequest: "phone-otp-request",
  phoneOtpVerify: "phone-otp-verify",
} as const;

export type RateLimitBucket = (typeof RATE_LIMIT_BUCKETS)[keyof typeof RATE_LIMIT_BUCKETS];

/**
 * Khoá đếm theo IP của một luồng — web và API đi qua CÙNG hàm này nên luôn
 * ra cùng một khoá.
 */
export function ipRateLimitKey(bucket: RateLimitBucket, ip: string): string {
  return `${bucket}:${ip}`;
}

/**
 * IP của người gọi, đọc từ header do reverse proxy đặt.
 *
 * ---
 * VÌ SAO KHÔNG LẤY PHẦN TỬ ĐẦU CỦA `X-Forwarded-For`
 *
 * Phần tử đầu do CLIENT gửi lên. Proxy kiểu nginx `proxy_add_x_forwarded_for`
 * chỉ NỐI THÊM IP thật vào cuối, nên `X-Forwarded-For: 1.2.3.4` tự chế đi qua
 * proxy thành `1.2.3.4, <ip thật>` — lấy phần tử đầu là để kẻ dò tự chọn xô
 * đếm cho mình, mỗi request một IP bịa, và rate limit mất tác dụng.
 *
 * Phần tử đáng tin là cái do proxy CỦA TA thêm vào: đếm từ PHẢI qua đúng số
 * proxy tin cậy (`TRUSTED_PROXY_HOPS`, mặc định 1 — một Caddy/nginx đứng trước
 * app). Proxy ghi đè hẳn header (Caddy) thì chuỗi chỉ còn một phần tử và phép
 * đếm này vẫn ra đúng nó.
 *
 * Không có `X-Forwarded-For` → `x-real-ip` → `"unknown"`. `"unknown"` nghĩa là
 * MỌI người chung một xô — thà chặt quá tay còn hơn mở toang; triệu chứng đó
 * nói rằng proxy chưa đặt header.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string {
  const hops =
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];

  if (hops.length > 0 && env.TRUSTED_PROXY_HOPS > 0) {
    // Ít phần tử hơn số proxy khai báo = cấu hình lệch (hoặc request không đi
    // qua đủ các tầng). Không có phần tử nào đáng tin hơn, lấy cái xa nhất.
    return hops[Math.max(0, hops.length - env.TRUSTED_PROXY_HOPS)]!;
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  limit: number;
  /** Số giây còn lại tới khi cửa sổ reset. */
  retryAfterSeconds: number;
};

/**
 * `hit` trả về số lần đã dùng trong cửa sổ hiện tại và thời điểm reset. Phần
 * quyết định cho qua hay chặn nằm NGOÀI store — nhờ vậy chính sách chỉ tồn tại
 * ở một chỗ, dù đang chạy trên RAM hay trên Redis.
 */
type RateLimitStore = {
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
  reset(key: string): Promise<void>;
  clear(): Promise<void>;
};

const REDIS_PREFIX = "rl:";

function createMemoryStore(): RateLimitStore {
  type Bucket = { count: number; resetAt: number };
  const buckets = new Map<string, Bucket>();

  /** Dọn bucket hết hạn để Map không phình vô hạn theo số IP đã từng gọi. */
  function evictExpired(now: number) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    hit(key, windowSeconds) {
      const now = Date.now();
      evictExpired(now);

      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + windowSeconds * 1000 };

      bucket.count += 1;
      buckets.set(key, bucket);

      return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
    },
    reset(key) {
      buckets.delete(key);
      return Promise.resolve();
    },
    clear() {
      buckets.clear();
      return Promise.resolve();
    },
  };
}

function createRedisStore(): RateLimitStore {
  async function client() {
    const redis = getRedis();
    if (!redis) throw new Error("Redis chưa được cấu hình");
    return redis;
  }

  return {
    async hit(key, windowSeconds) {
      const redis = await client();
      const redisKey = `${REDIS_PREFIX}${key}`;

      /*
       * INCR rồi mới EXPIRE, và chỉ EXPIRE ở lần đầu tiên (`NX`).
       *
       * Thứ tự này quan trọng: đặt lại TTL ở mỗi lần gọi sẽ biến cửa sổ cố
       * định thành cửa sổ trượt vô hạn — kẻ tấn công gõ đều tay thì khoá không
       * bao giờ hết hạn, kể cả sau khi họ đã dừng.
       *
       * Gộp vào một pipeline để chỉ đi MỘT vòng mạng.
       */
      const replies = (await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, "NX")
        .ttl(redisKey)
        .exec()) as unknown[];

      const count = Number(replies[0]);
      const ttl = Number(replies[2]);

      // TTL âm nghĩa là khoá không có hạn (-1) hoặc vừa biến mất (-2). Cả hai
      // đều bất thường; coi như cửa sổ vừa mở để không chặn oan người dùng.
      const remainingSeconds = Number.isFinite(ttl) && ttl >= 0 ? ttl : windowSeconds;

      return { count, resetAt: Date.now() + remainingSeconds * 1000 };
    },
    async reset(key) {
      await (await client()).del(`${REDIS_PREFIX}${key}`);
    },
    async clear() {
      const redis = await client();
      // Chỉ xoá khoá của rate limit — instance Redis này còn dùng cho cache và
      // hàng đợi.
      for await (const keys of redis.scanIterator({ MATCH: `${REDIS_PREFIX}*`, COUNT: 100 })) {
        const batch = Array.isArray(keys) ? keys : [keys];
        if (batch.length > 0) await redis.del(batch);
      }
    },
  };
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (store) return store;

  if (getRedis()) {
    store = createRedisStore();
  } else {
    store = createMemoryStore();
    logger.warn(
      "Rate limit chạy trong RAM (chưa set REDIS_URL). " +
        "Đủ cho một instance; từ instance thứ hai trở đi mỗi bản đếm riêng nên " +
        "ngưỡng thực tế bị nhân lên theo số instance.",
    );
  }

  return store;
}

export async function rateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  let hit: { count: number; resetAt: number };

  try {
    hit = await getStore().hit(key, options.windowSeconds);
  } catch (error) {
    /*
     * FAIL-OPEN, có chủ đích.
     *
     * Redis chết mà ta chặn hết mọi request thì một sự cố hạ tầng biến thành
     * sập dịch vụ toàn phần — đăng nhập, đăng ký, quên mật khẩu, tất cả đứng
     * im. Đổi lại là một cửa sổ không có rate limit, đúng bằng thời gian Redis
     * chết.
     *
     * Đánh đổi này CÓ THẬT: nếu hệ thống của bạn coi brute-force nguy hiểm hơn
     * downtime, đổi chỗ này thành chặn.
     */
    logger.error("Rate limit: store lỗi, tạm cho qua", error, { key });
    return { success: true, remaining: options.limit, limit: options.limit, retryAfterSeconds: 0 };
  }

  return {
    success: hit.count <= options.limit,
    remaining: Math.max(0, options.limit - hit.count),
    limit: options.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000)),
  };
}

/**
 * Đánh dấu `key` đã dùng; `true` khi đây là lần ĐẦU TIÊN trong `ttlSeconds`.
 *
 * Dùng cho thứ chỉ được tiêu MỘT lần nhưng không đáng một bảng database: vé
 * 2FA/passkey (theo `jti`) và bước thời gian TOTP đã dùng. Chạy trên cùng
 * store với rate limit vì cần đúng thứ nó có — bộ đếm NGUYÊN TỬ có hạn: hai
 * request song song cùng tiêu một vé thì INCR chỉ cho một bên thấy số 1.
 *
 * ⚠️ Cùng chính sách fail-open với `rateLimit`: store chết thì mọi lần đều là
 * "lần đầu". Đánh đổi có chủ đích — vé vẫn có chữ ký và hạn 5 phút.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const result = await rateLimit(`once:${key}`, {
    limit: 1,
    windowSeconds: Math.max(1, Math.ceil(ttlSeconds)),
  });
  return result.success;
}

/** Xoá giới hạn của một key — gọi sau khi đăng nhập THÀNH CÔNG. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await getStore().reset(key);
  } catch (error) {
    // Không ném lên: người dùng vừa đăng nhập thành công. Chặn họ chỉ vì dọn
    // bộ đếm thất bại là biến một thao tác nền thành lỗi nhìn thấy được.
    logger.error("Rate limit: không xoá được bộ đếm", error, { key });
  }
}

/** Chỉ dùng trong test. */
export async function __clearRateLimits(): Promise<void> {
  await getStore().clear();
}
