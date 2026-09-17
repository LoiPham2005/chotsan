import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { signSession } from "@/lib/session";

/**
 * Test tích hợp thật: dựng máy chủ realtime, nối client thật qua WebSocket.
 *
 * Điều đáng khoá chặt nhất là handshake — nếu ai đó lỡ tay bỏ middleware xác
 * thực, socket trở thành cửa sau đi vòng qua toàn bộ phân quyền của app.
 */

/**
 * Ảnh tài khoản (khoá / xoá / đổi mật khẩu) đọc từ database — giả lập, vì test
 * này không có Postgres. Thứ đang kiểm là handshake PHẢN ỨNG đúng với nó.
 */
const isTokenStillValid = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/services/security-stamp.service", () => ({
  securityStampService: { isTokenStillValid },
}));

const PORT = 34567;
process.env.REALTIME_PORT = String(PORT);
process.env.REALTIME_CORS_ORIGIN = "http://localhost:3000";
delete process.env.REDIS_URL; // chạy một instance, không cần adapter

const URL = `http://127.0.0.1:${PORT}`;

let stopServer: (() => Promise<void>) | undefined;
let PING_USER_RATE_LIMIT: { limit: number; windowMs: number };
let createSocketRateLimiter: (
  options: { limit: number; windowMs: number },
  now?: () => number,
) => () => boolean;
const openClients: ClientSocket[] = [];

function connect(token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(URL, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(socket);

    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}

beforeAll(async () => {
  const server = await import("./server");
  PING_USER_RATE_LIMIT = server.PING_USER_RATE_LIMIT;
  createSocketRateLimiter = server.createSocketRateLimiter;
  const handle = await server.startRealtime();
  stopServer = handle.stop;
}, 20_000);

afterAll(async () => {
  for (const socket of openClients) socket.close();
  await stopServer?.();
});

describe("handshake", () => {
  it("từ chối kết nối KHÔNG có token", async () => {
    await expect(connect()).rejects.toThrow(/unauthorized/);
  });

  it("từ chối token rác", async () => {
    await expect(connect("khong-phai-jwt")).rejects.toThrow(/unauthorized/);
  });

  it("từ chối token bị sửa nội dung", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });
    const [header, body, signature] = token.split(".");
    const tampered = JSON.parse(atob(body!)) as Record<string, unknown>;
    tampered.role = "ADMIN";
    const forged = `${header}.${btoa(JSON.stringify(tampered)).replaceAll("=", "")}.${signature}`;

    await expect(connect(forged)).rejects.toThrow(/unauthorized/);
  });

  it("từ chối token ĐÚNG chữ ký của phiên đã bị thu hồi (khoá, xoá, đổi mật khẩu)", async () => {
    isTokenStillValid.mockResolvedValueOnce(false);
    const token = await signSession({
      sub: "u-bi-khoa",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });

    await expect(connect(token)).rejects.toThrow(/unauthorized/);
    expect(isTokenStillValid).toHaveBeenCalledWith("u-bi-khoa", expect.any(Number));
  });

  it("nối lại trong cửa sổ phục hồi phiên (2 phút) VẪN đi qua kiểm tra thu hồi", async () => {
    // socket.io mặc định BỎ QUA middleware khi phục hồi được phiên cũ: tài khoản
    // vừa bị khoá chỉ cần rớt mạng rồi nối lại là vào được, không ai kiểm.
    const token = await signSession({
      sub: "u-rot-mang",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });
    const socket = createClient(URL, {
      auth: { token },
      transports: ["websocket"],
      reconnectionDelay: 50,
      reconnectionDelayMax: 100,
    });
    openClients.push(socket);
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

    // Phục hồi cần một mốc tin đã nhận: tự gửi cho mình một tin trước khi rớt.
    const received = new Promise<void>((resolve) => socket.once("message:new", () => resolve()));
    socket.emit("ping:user", { toUserId: "u-rot-mang", text: "mốc" });
    await received;

    isTokenStillValid.mockResolvedValue(false);
    try {
      const outcome = new Promise<string>((resolve) => {
        socket.once("connect_error", (error) => resolve(error.message));
        socket.once("connect", () => resolve(`đã nối lại (recovered=${socket.recovered})`));
      });
      // Rớt mạng đột ngột — "transport close" nằm trong nhóm lý do được phục hồi.
      socket.io.engine.close();

      await expect(outcome).resolves.toBe("unauthorized");
      expect(isTokenStillValid).toHaveBeenCalledWith("u-rot-mang", expect.any(Number));
    } finally {
      isTokenStillValid.mockImplementation(() => Promise.resolve(true));
    }
  });

  it("chấp nhận token hợp lệ", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });
    const socket = await connect(token);

    expect(socket.connected).toBe(true);
  });
});

describe("phát tin theo người dùng", () => {
  it("tin nhắn tới MỌI thiết bị của người nhận, không lọt sang người khác", async () => {
    const alice = await connect(
      await signSession({
        sub: "alice",
        email: "alice@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    // Bob mở hai thiết bị — cả hai phải cùng nhận.
    const bobPhone = await connect(
      await signSession({
        sub: "bob",
        email: "bob@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    const bobLaptop = await connect(
      await signSession({
        sub: "bob",
        email: "bob@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    const carol = await connect(
      await signSession({
        sub: "carol",
        email: "carol@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );

    const received: string[] = [];
    bobPhone.on("message:new", () => received.push("phone"));
    bobLaptop.on("message:new", () => received.push("laptop"));
    carol.on("message:new", () => received.push("carol")); // KHÔNG được nhận

    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      alice.emit("ping:user", { toUserId: "bob", text: "hi" }, resolve);
    });

    expect(ack.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 300));
    expect(received.sort()).toEqual(["laptop", "phone"]);
  }, 15_000);
});

/**
 * `ping:user` nhận dữ liệu từ client đã đăng nhập — đăng nhập KHÔNG có nghĩa là
 * tin được. Lỗi thật trước đây: gửi `null` làm listener ném TypeError không ai
 * bắt → tiến trình realtime chết → mọi người đang online rớt kết nối.
 */
describe("ping:user — dữ liệu từ client", () => {
  async function userSocket(sub: string) {
    return connect(
      await signSession({ sub, email: `${sub}@x.com`, typ: "access" as const, roles: ["USER"] }),
    );
  }

  function emitWithAck(socket: ClientSocket, payload: unknown) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit("ping:user", payload, resolve);
    });
  }

  it("payload sai hình dạng → INVALID_PAYLOAD, không phát tin, máy chủ vẫn sống", async () => {
    const sender = await userSocket("mallory");
    const target = await userSocket("victim");
    const received: unknown[] = [];
    target.on("message:new", (message) => received.push(message));

    for (const payload of [null, "chuỗi", { toUserId: 42 }, { toUserId: "victim", text: "" }]) {
      await expect(emitWithAck(sender, payload)).resolves.toEqual({
        ok: false,
        error: "INVALID_PAYLOAD",
      });
    }
    // Đối số ack không phải hàm cũng không được làm sập listener.
    sender.emit("ping:user", { toUserId: "victim", text: "hi" }, "không-phải-hàm");

    await expect(emitWithAck(sender, { toUserId: "victim", text: "vẫn chạy" })).resolves.toEqual({
      ok: true,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(2);
  }, 15_000);

  it("quá 10 tin trong 10 giây trên MỘT socket → RATE_LIMITED, tin thứ 11 không đi", async () => {
    const sender = await userSocket("spammer");

    const results = [];
    for (let i = 0; i < PING_USER_RATE_LIMIT.limit + 1; i += 1) {
      results.push(await emitWithAck(sender, { toUserId: "ai-do", text: `tin ${i}` }));
    }

    expect(results.slice(0, PING_USER_RATE_LIMIT.limit).every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toEqual({ ok: false, error: "RATE_LIMITED" });

    // Socket khác (thiết bị khác) có hạn mức riêng.
    const otherDevice = await userSocket("spammer");
    await expect(
      emitWithAck(otherDevice, { toUserId: "ai-do", text: "máy khác" }),
    ).resolves.toEqual({ ok: true });
  }, 15_000);
});

describe("createSocketRateLimiter", () => {
  it("cửa sổ cố định: đủ hạn mức thì chặn, sang cửa sổ mới thì mở lại", () => {
    let now = 1_000;
    const allow = createSocketRateLimiter({ limit: 2, windowMs: 10_000 }, () => now);

    expect([allow(), allow(), allow()]).toEqual([true, true, false]);

    now += 9_999;
    expect(allow()).toBe(false);

    now += 1;
    expect(allow()).toBe(true);
  });
});
