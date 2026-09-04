import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BookingNotFoundError, BookingStateError, DomainError } from "@/lib/errors";

/**
 * Đánh giá sân.
 *
 * ---
 * CHỈ NGƯỜI ĐÃ CHƠI MỚI ĐƯỢC CHẤM
 *
 * Mỗi đánh giá buộc phải gắn với MỘT lượt đặt đã diễn ra của chính người đó
 * (`Review.bookingId` là khoá duy nhất). Không có ràng buộc này thì đối thủ mở
 * mười tài khoản là dìm được điểm một sân trong một buổi tối, còn chủ sân thì
 * tự bơm sao cho mình.
 *
 * Điều đó cũng có nghĩa: một lượt đặt = một đánh giá, không sửa được thành
 * nhiều. Muốn đổi ý thì sửa chính đánh giá đó.
 */
export class ReviewService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Khách chấm sao cho một lượt đặt đã xong.
   *
   * Cập nhật `ratingAvg`/`ratingCount` của cơ sở trong CÙNG transaction: hai
   * con số đó là dữ liệu dẫn xuất, để chúng lệch với bảng `reviews` là sân hiện
   * 4.8 sao trong khi thực tế 3.1 và không ai biết vì sao.
   */
  async create(input: {
    bookingId: string;
    userId: string;
    rating: number;
    comment?: string | null;
    now?: Date;
  }) {
    const booking = await this.db.booking.findFirst({
      where: { id: input.bookingId, userId: input.userId },
      select: {
        id: true,
        venueId: true,
        status: true,
        endAt: true,
        review: { select: { id: true } },
      },
    });

    // Không tìm thấy và không phải của mình trả CÙNG một lỗi — nói khác đi là
    // xác nhận lượt đặt đó có tồn tại.
    if (!booking) throw new BookingNotFoundError();
    if (booking.review) throw new BookingStateError("Bạn đã đánh giá lượt đặt này rồi");

    const now = input.now ?? new Date();
    if (booking.endAt > now) throw new BookingStateError("Chơi xong rồi hãy đánh giá nhé");
    if (!["CHECKED_IN", "COMPLETED"].includes(booking.status)) {
      throw new BookingStateError("Chỉ đánh giá được lượt đặt đã diễn ra");
    }

    const rating = Math.round(input.rating);
    if (rating < 1 || rating > 5) throw new ReviewRatingError();

    return this.db.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          venueId: booking.venueId,
          bookingId: booking.id,
          userId: input.userId,
          rating,
          comment: input.comment?.trim() || null,
        },
      });

      await this.recomputeRating(tx as unknown as PrismaClient, booking.venueId);
      return review;
    });
  }

  /** Chủ sân trả lời một đánh giá. Không sửa được nội dung của khách. */
  async reply(input: { reviewId: string; venueId: string; reply: string; now?: Date }) {
    const review = await this.db.review.findFirst({
      where: { id: input.reviewId, venueId: input.venueId },
      select: { id: true },
    });

    if (!review) throw new BookingNotFoundError();

    return this.db.review.update({
      where: { id: input.reviewId },
      data: { ownerReply: input.reply.trim(), ownerRepliedAt: input.now ?? new Date() },
    });
  }

  /** Đánh giá công khai của một cơ sở. Ẩn thì không trả về. */
  async listForVenue(venueId: string, options: { limit?: number } = {}) {
    return this.db.review.findMany({
      where: { venueId, isHidden: false },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
      select: {
        id: true,
        rating: true,
        comment: true,
        ownerReply: true,
        ownerRepliedAt: true,
        createdAt: true,
        user: { select: { profile: { select: { fullName: true } } } },
      },
    });
  }

  /**
   * Tính lại điểm trung bình từ bảng `reviews`.
   *
   * Đọc lại toàn bộ thay vì cộng dồn: cộng dồn sai một lần là sai vĩnh viễn và
   * không có cách nào phát hiện, còn tính lại thì luôn đúng. Một sân có vài
   * nghìn đánh giá vẫn là một câu `aggregate` trong vài mili giây.
   */
  private async recomputeRating(db: PrismaClient, venueId: string) {
    const stats = await db.review.aggregate({
      where: { venueId, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await db.venue.update({
      where: { id: venueId },
      data: {
        ratingAvg: stats._avg.rating ?? 0,
        ratingCount: stats._count._all,
      },
    });
  }
}

/** Điểm nằm ngoài 1–5. Database cũng chặn, đây là lớp báo lỗi tử tế. */
export class ReviewRatingError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor() {
    super("Điểm đánh giá phải từ 1 tới 5 sao");
  }
}

export const reviewService = new ReviewService();
