import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BookingNotFoundError,
  BookingStateError,
  ReviewNotFoundError,
  ReviewRatingError,
} from "@/lib/errors";

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
    // Kiểm điểm TRƯỚC mọi thứ và KHÔNG làm tròn: `Math.round(NaN)` là NaN, lọt
    // qua `< 1 || > 5`; còn 4.6 làm tròn thành 5 là tự chấm hộ khách một điểm.
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new ReviewRatingError();
    }

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

    return this.db.$transaction(async (tx) => {
      /*
       * Khoá dòng cơ sở TRƯỚC khi ghi đánh giá.
       *
       * Không khoá thì hai đánh giá cùng lúc cho một sân đua nhau: mỗi bên tính
       * trung bình từ ảnh chụp KHÔNG thấy đánh giá chưa commit của bên kia, bên
       * ghi sau đè mất phần của bên ghi trước — điểm lệch vĩnh viễn. Một câu
       * UPDATE có subquery cũng KHÔNG đủ: ở READ COMMITTED, câu chờ khoá xong vẫn
       * dùng ảnh chụp lấy từ lúc nó bắt đầu. Khoá ở đây thì mọi câu lệnh sau đều
       * bắt đầu SAU khi bên kia commit, nên thấy đủ.
       *
       * `FOR NO KEY UPDATE` chứ không `FOR UPDATE`: hai người ghi đánh giá vẫn
       * phải xếp hàng, nhưng phép kiểm khoá ngoại của lượt đặt/sân con đang ghi
       * vào cùng cơ sở (`FOR KEY SHARE`) không bị chặn theo.
       */
      await tx.$queryRaw`SELECT id FROM venues WHERE id = ${booking.venueId} FOR NO KEY UPDATE`;

      const review = await tx.review.create({
        data: {
          venueId: booking.venueId,
          bookingId: booking.id,
          userId: input.userId,
          rating: input.rating,
          comment: input.comment?.trim() || null,
        },
      });

      await this.recomputeRating(tx as unknown as PrismaClient, booking.venueId);
      return review;
    });
  }

  /** Chủ sân trả lời một đánh giá. Không sửa được nội dung của khách. */
  async reply(input: { reviewId: string; venueId: string; reply: string; now?: Date }) {
    // `venueId` nằm TRONG câu truy vấn: id đánh giá đến từ form, đánh giá của
    // sân khác thì coi như không tồn tại (GOTCHAS #19).
    const review = await this.db.review.findFirst({
      where: { id: input.reviewId, venueId: input.venueId },
      select: { id: true },
    });

    if (!review) throw new ReviewNotFoundError();

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
   *
   * ⚠️ Chỉ đúng khi dòng cơ sở ĐÃ bị khoá trong transaction đang chạy — xem `create`.
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

export const reviewService = new ReviewService();
