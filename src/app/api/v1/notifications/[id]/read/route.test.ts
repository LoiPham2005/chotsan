import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as NotificationServiceModule from "@/services/notification.service";

/**
 * `POST /api/v1/notifications/{id}/read` — idempotent.
 *
 * Lỗi thật trước đây: lần gọi thứ hai (app gửi lại khi mạng chập chờn, hai thiết
 * bị cùng mở) trả 404 cho một thông báo vừa đọc xong. 404 chỉ dành cho "không có"
 * hoặc "của người khác" — và hai ca đó phải giống hệt nhau.
 */

vi.mock("@/lib/api/auth", () => ({
  requireApiUser: vi.fn(() =>
    Promise.resolve({ sub: "u1", email: "a@b.c", typ: "access", roles: ["USER"] }),
  ),
}));

vi.mock("@/services/notification.service", async (importOriginal) => {
  const actual = await importOriginal<typeof NotificationServiceModule>();
  return { ...actual, notificationService: { markRead: vi.fn() } };
});

import { notificationService } from "@/services/notification.service";
import { POST } from "./route";

function read(id: string) {
  return POST(new Request(`http://localhost/api/v1/notifications/${id}/read`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /notifications/{id}/read", () => {
  it("đọc rồi gọi lại vẫn 200 — service báo tồn tại là đủ", async () => {
    vi.mocked(notificationService.markRead).mockResolvedValue(true);

    const first = await read("r1");
    const second = await read("r1");

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.json()).toEqual({ data: { id: "r1" } });
    // userId lấy từ TOKEN, không từ tham số.
    expect(notificationService.markRead).toHaveBeenCalledWith("r1", "u1");
  });

  it("không có hoặc của người khác → 404 NOT_FOUND", async () => {
    vi.mocked(notificationService.markRead).mockResolvedValue(false);

    const response = await read("cua-nguoi-khac");

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
