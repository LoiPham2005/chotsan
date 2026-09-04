import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { BookingNotFoundError, BookingStateError } from "@/lib/errors";
import { ReviewRatingError, ReviewService } from "./review.service";

/**
 * Đánh giá là thứ quyết định sân nào được đặt. Nếu ai cũng chấm được thì đối
 * thủ mở mười tài khoản là dìm xong một sân trong một buổi tối.
 */

const NOW = new Date("2026-09-04T12:00:00Z");
const DA_XONG = {
  id: "b1",
  venueId: "v1",
  status: "COMPLETED",
  endAt: new Date("2026-09-04T10:00:00Z"),
  review: null,
};

function createDb(booking: Partial<typeof DA_XONG> | null = {}) {
  const db = {
    booking: {
      findFirst: vi.fn().mockResolvedValue(booking === null ? null : { ...DA_XONG, ...booking }),
    },
    review: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "r1", ...data }),
      ),
      findFirst: vi.fn().mockResolvedValue({ id: "r1" }),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "r1", ...data }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _avg: { rating: 4.25 }, _count: { _all: 4 } }),
    },
    venue: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

const input = { bookingId: "b1", userId: "u1", rating: 5, now: NOW };

beforeEach(() => vi.clearAllMocks());

describe("create — khách chấm sao", () => {
  it("ghi đánh giá gắn với lượt đặt đã chơi", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create({ ...input, comment: "  Sân đẹp  " });

    expect(mock.review.create.mock.calls[0]![0].data).toMatchObject({
      venueId: "v1",
      bookingId: "b1",
      userId: "u1",
      rating: 5,
      comment: "Sân đẹp",
    });
  });

  it("bình luận trắng thì lưu null, không lưu chuỗi rỗng", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create({ ...input, comment: "   " });

    expect(mock.review.create.mock.calls[0]![0].data.comment).toBeNull();
  });

  /**
   * Ràng buộc quan trọng nhất của cả tệp: không có nó thì điểm sao vô nghĩa.
   */
  it("không đánh giá được lượt đặt của người khác", async () => {
    const { db, mock } = createDb(null);

    await expect(new ReviewService(db).create(input)).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.review.create).not.toHaveBeenCalled();
    // Câu truy vấn ràng buộc CẢ id LẪN userId — không phải kiểm rời sau đó.
    const [{ where }] = mock.booking.findFirst.mock.calls[0] as [
      { where: { id: string; userId: string } },
    ];
    expect(where).toMatchObject({ id: "b1", userId: "u1" });
  });

  it("không đánh giá hai lần cho một lượt đặt", async () => {
    const { db } = createDb({ review: { id: "r0" } as never });

    await expect(new ReviewService(db).create(input)).rejects.toThrow("đã đánh giá");
  });

  it("chưa đá xong thì chưa chấm được", async () => {
    const { db } = createDb({ endAt: new Date("2026-09-04T14:00:00Z") });

    await expect(new ReviewService(db).create(input)).rejects.toThrow("Chơi xong rồi");
  });

  it("lượt đã huỷ hoặc chưa tới sân thì không chấm được", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "CONFIRMED", "NO_SHOW"]) {
      const { db } = createDb({ status });
      await expect(new ReviewService(db).create(input)).rejects.toBeInstanceOf(BookingStateError);
    }
  });

  it("điểm ngoài 1–5 bị chặn", async () => {
    for (const rating of [0, 6, -1, 99]) {
      const { db } = createDb();
      await expect(new ReviewService(db).create({ ...input, rating })).rejects.toBeInstanceOf(
        ReviewRatingError,
      );
    }
  });

  /**
   * `ratingAvg` là dữ liệu dẫn xuất. Để nó lệch với bảng `reviews` là sân hiện
   * 4.8 sao trong khi thực tế 3.1, và không ai lần ra vì sao.
   */
  it("tính lại điểm trung bình của sân trong CÙNG transaction", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).create(input);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.review.aggregate).toHaveBeenCalledTimes(1);
    const [{ data }] = mock.venue.update.mock.calls[0] as [{ data: Record<string, number> }];
    expect(data).toEqual({ ratingAvg: 4.25, ratingCount: 4 });
  });

  it("sân chưa có đánh giá nào thì điểm về 0, không phải null", async () => {
    const { db, mock } = createDb();
    mock.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });

    await new ReviewService(db).create(input);

    const [{ data }] = mock.venue.update.mock.calls[0] as [{ data: Record<string, number> }];
    expect(data).toEqual({ ratingAvg: 0, ratingCount: 0 });
  });
});

describe("reply — chủ sân trả lời", () => {
  it("ghi lời đáp và mốc thời gian", async () => {
    const { db, mock } = createDb();
    await new ReviewService(db).reply({
      reviewId: "r1",
      venueId: "v1",
      reply: "  Cảm ơn bạn  ",
      now: NOW,
    });

    expect(mock.review.update.mock.calls[0]![0].data).toEqual({
      ownerReply: "Cảm ơn bạn",
      ownerRepliedAt: NOW,
    });
  });

  it("không trả lời được đánh giá của sân khác", async () => {
    const { db, mock } = createDb();
    mock.review.findFirst.mockResolvedValue(null);

    await expect(
      new ReviewService(db).reply({ reviewId: "r1", venueId: "v-khac", reply: "x" }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.review.update).not.toHaveBeenCalled();
  });
});
