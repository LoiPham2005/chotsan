import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiAuthModule from "@/lib/api/auth";

/**
 * `POST /api/v1/files` ở production khi CHƯA cắm kho lưu trữ.
 *
 * Lỗi thật trước đây: mọi lần tải lên trên production trả 500 "Lỗi máy chủ. Vui
 * lòng thử lại." — client thử lại mãi, người vận hành chỉ thấy stack trace. Đây
 * là lỗi cấu hình, phải nói thẳng bằng 503.
 *
 * Xác thực được giả: bài này không kiểm quyền (đã có ở `src/lib/api`).
 */

// Chỉ giả phần XÁC THỰC; giới hạn tần suất chạy thật (bộ đếm RAM, không cần Redis).
// `importActual` gọi LÚC CHẠY, không lúc dựng mock: bài nào cũng `resetModules`,
// nạp sẵn từ trước là `ApiError` của bản module cũ — `instanceof` trượt, 429 thành 500.
vi.mock("@/lib/api/auth", () => ({
  requireApiPermission: vi.fn(() =>
    Promise.resolve({ sub: "user-1", email: "a@b.c", typ: "access", roles: ["USER"] }),
  ),
  enforceRateLimit: vi.fn(async (...args: Parameters<typeof ApiAuthModule.enforceRateLimit>) => {
    const actual = await vi.importActual<typeof ApiAuthModule>("@/lib/api/auth");
    return actual.enforceRateLimit(...args);
  }),
}));

let requestCount = 0;

/**
 * Bốn byte đầu của PNG thật, đủ để qua bước kiểm magic bytes. Mỗi request một IP
 * riêng: bộ đếm giới hạn tần suất sống qua các bài, không được để bài này làm
 * bài kia chạm ngưỡng.
 */
function pngUpload(ip = `10.0.0.${++requestCount}`): Request {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);

  const form = new FormData();
  form.set("file", new File([bytes], "anh.png", { type: "image/png" }));

  return new Request("http://localhost/api/v1/files", {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": ip },
  });
}

async function loadRoute() {
  vi.resetModules();
  const storage = await import("@/lib/storage");
  const route = await import("./route");
  return { storage, POST: route.POST };
}

type ErrorBody = { error: { code: string; message: string } };

beforeEach(() => {
  // logger.error ghi ra console — bài này cố ý đi vào nhánh đó.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/files — kho lưu trữ chưa cấu hình", () => {
  it("production chưa setStorage → 503 PROVIDER_ERROR kèm lời giải thích, không 500", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await loadRoute();

    const response = await POST(pngUpload());
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(body.error.message).toMatch(/chưa cấu hình nơi lưu tệp/);
  });

  it("production ĐÃ setStorage → lưu qua nhà cung cấp đó, 201", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { storage, POST } = await loadRoute();
    const put = vi.fn(() =>
      Promise.resolve({
        key: "k.png",
        url: "https://cdn/k.png",
        size: 64,
        contentType: "image/png",
      }),
    );
    storage.setStorage({ put, delete: () => Promise.resolve() });

    const response = await POST(pngUpload());

    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("StorageNotConfiguredError ném ra từ chính `put` cũng thành 503, không 500", async () => {
    // Phép kiểm sớm đã qua (có setStorage) nhưng nhà cung cấp vẫn báo chưa cấu
    // hình — vd bản bọc quanh bản ghi đĩa cục bộ. Nhánh bắt lỗi phải dịch được.
    vi.stubEnv("NODE_ENV", "production");
    const { storage, POST } = await loadRoute();
    const put = vi.fn(() => Promise.reject(new storage.StorageNotConfiguredError()));
    storage.setStorage({ put, delete: () => Promise.resolve() });

    const response = await POST(pngUpload());

    expect(put).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });
});

describe("POST /api/v1/files — giới hạn tần suất", () => {
  it("vượt ngưỡng upload → 429 RATE_LIMITED, không đụng tới kho lưu trữ", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { storage, POST } = await loadRoute();
    const { RATE_LIMITS } = await import("@/lib/rate-limit");
    const put = vi.fn(() =>
      Promise.resolve({ key: "k.png", url: "/uploads/k.png", size: 64, contentType: "image/png" }),
    );
    storage.setStorage({ put, delete: () => Promise.resolve() });

    const statuses: number[] = [];
    for (let i = 0; i <= RATE_LIMITS.upload.limit; i += 1) {
      statuses.push((await POST(pngUpload("203.0.113.9"))).status);
    }

    expect(statuses.slice(0, RATE_LIMITS.upload.limit).every((status) => status === 201)).toBe(
      true,
    );
    expect(statuses.at(-1)).toBe(429);
    expect(put).toHaveBeenCalledTimes(RATE_LIMITS.upload.limit);
  });
});

describe("isStorageConfigured", () => {
  it("dev: bản ghi đĩa cục bộ dùng được", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { storage } = await loadRoute();

    expect(storage.isStorageConfigured()).toBe(true);
  });

  it("production: chỉ true sau khi setStorage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { storage } = await loadRoute();

    expect(storage.isStorageConfigured()).toBe(false);
    await expect(
      storage.getStorage().put(Buffer.from("x"), "a.png", { contentType: "image/png" }),
    ).rejects.toBeInstanceOf(storage.StorageNotConfiguredError);

    storage.setStorage({ put: vi.fn(), delete: vi.fn() });
    expect(storage.isStorageConfigured()).toBe(true);
  });
});
