import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationService } from "./notification.service";

/**
 * Hộp thông báo của CHÍNH người dùng. Loại lỗi đắt nhất ở tầng này: đánh dấu
 * được thông báo của người khác (id đến từ client), và trả "không tìm thấy" cho
 * một thông báo vừa đọc xong — app mobile gửi lại request khi mạng chập chờn là
 * gặp ngay.
 */

vi.mock("@/lib/queue", () => ({ enqueue: vi.fn() }));

type Recipient = { id: string; userId: string; isRead: boolean; readAt: Date | null };

const READ_AT = new Date("2026-09-04T08:00:00+07:00");

/** Mock LỌC THẬT theo `where` — ép trả bừa thì bài "của người khác" không chứng minh gì. */
function createDb(rows: Recipient[]) {
  const matches = (row: Recipient, where: Partial<Recipient>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Recipient] === value);

  const db = {
    notificationRecipient: {
      updateMany: vi.fn(
        ({ where, data }: { where: Partial<Recipient>; data: Partial<Recipient> }) => {
          const hit = rows.filter((row) => matches(row, where));
          for (const row of hit) Object.assign(row, data);
          return Promise.resolve({ count: hit.length });
        },
      ),
      count: vi.fn(({ where }: { where: Partial<Recipient> }) =>
        Promise.resolve(rows.filter((row) => matches(row, where)).length),
      ),
    },
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("markRead — đánh dấu đã đọc", () => {
  it("lần đầu: đánh dấu và trả true", async () => {
    const rows = [{ id: "r1", userId: "u1", isRead: false, readAt: null }];
    const { db } = createDb(rows);

    await expect(new NotificationService(db).markRead("r1", "u1")).resolves.toBe(true);
    expect(rows[0]!.isRead).toBe(true);
  });

  it("gọi lại khi ĐÃ đọc vẫn true — và giữ nguyên mốc đọc đầu tiên", async () => {
    // Lỗi thật trước đây: lần hai trả false → route trả 404.
    const rows = [{ id: "r1", userId: "u1", isRead: true, readAt: READ_AT }];
    const { db, mock } = createDb(rows);

    await expect(new NotificationService(db).markRead("r1", "u1")).resolves.toBe(true);
    expect(rows[0]!.readAt).toBe(READ_AT);
    expect(mock.notificationRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", userId: "u1", isRead: false } }),
    );
  });

  it("thông báo của NGƯỜI KHÁC → false và không ghi gì", async () => {
    const rows = [{ id: "r1", userId: "u1", isRead: false, readAt: null }];
    const { db } = createDb(rows);

    await expect(new NotificationService(db).markRead("r1", "ke-la")).resolves.toBe(false);
    expect(rows[0]!.isRead).toBe(false);
  });

  it("id không tồn tại → false", async () => {
    const { db } = createDb([]);

    await expect(new NotificationService(db).markRead("khong-co", "u1")).resolves.toBe(false);
  });
});
