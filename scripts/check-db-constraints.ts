/**
 * `pnpm db:check-conflict` — kiểm trên DATABASE THẬT: hai người bấm đặt cùng một khung trong cùng một
 * giây thì đúng MỘT người được sân. Mock không chứng minh được điều này —
 * chỉ ràng buộc EXCLUDE trong Postgres mới quyết được ai thắng.
 *
 * Test bằng mock trong `booking.service.test.ts` kiểm ĐƯỜNG XỬ LÝ khi lỗi 23P01
 * bắn ra; tệp này kiểm rằng lỗi đó THẬT SỰ bắn ra. Hai thứ khác nhau — và chính
 * tệp này đã bắt được lỗi `reschedule()` tự chặn chính mình, thứ mà mock không
 * thể thấy vì mock luôn trả "còn trống".
 *
 * Chạy được trên database nào cũng được: nó tự tạo sân riêng rồi tự xoá — phần
 * dọn nằm trong `finally`, nên kịch bản nào ném lỗi giữa chừng cũng không để lại
 * cơ sở `kiem-tra-*` đang mở bán trên trang tìm sân.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AvailabilityService } from "@/services/availability.service";
import { BookingService } from "@/services/booking.service";
import { PaymentService } from "@/services/payment.service";
import { ReviewService } from "@/services/review.service";
import { VenueService } from "@/services/venue.service";
import { SlotTakenError, SlotUnavailableError, VenueDraftLimitError } from "@/lib/errors";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Tên lớp lỗi để in ra và so sánh — `"CHO QUA"` khi thao tác không ném gì. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : String(error);
}

async function outcomeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "CHO QUA";
  } catch (error) {
    return errorName(error);
  }
}

/**
 * Xoá mọi thứ của cơ sở kiểm tra, theo đúng thứ tự khoá ngoại. Sân con, giờ mở
 * cửa, luật giá, lịch đóng sân, thành viên đi theo cơ sở (cascade); đánh giá,
 * lượt đặt, tiền, hoá đơn thì `Restrict` nên phải xoá tay trước.
 */
async function cleanUp(venueId: string): Promise<void> {
  const bookingIds = (await db.booking.findMany({ where: { venueId }, select: { id: true } })).map(
    (booking) => booking.id,
  );
  const paymentIds = (
    await db.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } })
  ).map((payment) => payment.id);

  await db.review.deleteMany({ where: { venueId } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await db.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await db.booking.deleteMany({ where: { venueId } });
  await db.platformInvoice.deleteMany({ where: { venueId } });
  await db.venue.delete({ where: { id: venueId } });
}

/** Mã lượt đặt giả cho các dòng ghi thẳng vào database (6 ký tự như mã thật). */
function fakeBookingCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");
}

async function main() {
  let ok = true;
  const report = (label: string, passed: boolean, detail: string) => {
    if (!passed) ok = false;
    console.log(`${passed ? "✓" : "✗"} ${label} — ${detail}`);
  };

  const suffix = Date.now().toString(36);
  const slug = `kiem-tra-${suffix}`;
  let venueId: string | null = null;
  // Những thứ phần năm tạo thêm — cũng phải dọn trong `finally`.
  const extraVenueIds: string[] = [];
  let testUserId: string | null = null;

  try {
    // ---------------------------------------------------------------------
    // Phần không: RÀNG BUỘC VIẾT TAY CÒN NGUYÊN KHÔNG
    //
    // `prisma migrate diff` đòi xoá mọi index/ràng buộc không có trong
    // schema.prisma, và nếu ai đó áp thẳng SQL nó sinh ra thì chúng biến mất
    // trong im lặng — test vẫn xanh, chỉ có chống trùng chỗ và chống trùng tiền
    // là không còn. Xem GOTCHAS #11. Đây là chốt chặn cuối cho chuyện đó.
    //
    // Tên ràng buộc viết tay GIỮ NGUYÊN tiếng Việt: mã tham chiếu theo tên, đổi
    // là phải đổi cả migration đã áp.
    // ---------------------------------------------------------------------
    const REQUIRED_CONSTRAINTS = [
      "bookings_khong_trung_khung_gio",
      "payments_mot_giao_dich_song_cho_moi_booking",
      "venue_members_mot_chu_cho_moi_co_so",
      "venues_name_trgm_idx",
      "venues_address_trgm_idx",
      "users_email_active_key",
      "users_phone_active_key",
      "reviews_diem_tu_1_den_5",
      "bookings_khoang_thoi_gian_hop_le",
      "bookings_tien_khong_am",
      "payments_tien_hop_le",
      "venue_hours_gio_dong_sau_gio_mo",
      "price_rules_khung_gio_hop_le",
      "venues_phi_huy_tu_0_den_100",
      // Sequence cấp số hoá đơn (viết tay trong migration, Prisma không biết tới):
      // mất nó là mọi lần xuất hoá đơn hỏng.
      "platform_invoice_number_seq",
      // Prisma quản lý, nhưng là chốt nghiệp vụ: lượt đặt/luật giá không trỏ được
      // sân con của CƠ SỞ KHÁC.
      "courts_id_venue_id_key",
      "bookings_court_id_venue_id_fkey",
      "price_rules_court_id_venue_id_fkey",
    ];

    const existing = new Set(
      (
        await db.$queryRawUnsafe<{ name: string }[]>(
          `select indexname as name from pg_indexes where schemaname = 'public'
           union select conname as name from pg_constraint
           union select relname as name from pg_class where relkind = 'S'`,
        )
      ).map((row) => row.name),
    );

    const missing = REQUIRED_CONSTRAINTS.filter((name) => !existing.has(name));

    report(
      `${REQUIRED_CONSTRAINTS.length} ràng buộc viết tay còn nguyên`,
      missing.length === 0,
      missing.length === 0 ? "không mất cái nào" : `MẤT: ${missing.join(", ")}`,
    );

    const sport = await db.sport.upsert({
      where: { key: "badminton" },
      update: {},
      create: { key: "badminton", name: "Cầu lông" },
    });

    const venue = await db.venue.create({
      data: {
        slug,
        name: "Sân kiểm tra",
        sportId: sport.id,
        address: "1 Đường Test",
        ward: "Phường Cầu Giấy",
        province: "Hà Nội",
        holdMinutes: 10,
        status: "ACTIVE",
        hours: {
          create: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            openMinute: 6 * 60,
            closeMinute: 22 * 60,
            isClosed: false,
          })),
        },
        bankName: "VCB",
        bankAccountNumber: "1234567890",
        bankAccountName: "SAN KIEM TRA",
        courts: {
          create: [
            { name: "Sân 1", sortOrder: 1, isActive: true, sportId: sport.id },
            { name: "Sân 2", sortOrder: 2, isActive: true, sportId: sport.id },
          ],
        },
        priceRules: {
          create: [
            { weekdays: [], startMinute: 0, endMinute: 24 * 60, pricePerSlot: 60_000, priority: 0 },
          ],
        },
      },
      include: { courts: true },
    });
    venueId = venue.id;

    const court1 = venue.courts.find((item) => item.name === "Sân 1")!;
    const court2 = venue.courts.find((item) => item.name === "Sân 2")!;
    const bookings = new BookingService(db, new AvailabilityService(db));
    const payments = new PaymentService(db);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const hold = (customerName: string, start = 19 * 60, end = 21 * 60) =>
      bookings.hold({
        venueId: venue.id,
        courtId: court1.id,
        date: tomorrow,
        startMinute: start,
        endMinute: end,
        customerName,
        customerPhone: "0900000000",
      });

    // 1. ĐỒNG THỜI, không tuần tự. Bên thua có hai đường hợp lệ: cả hai cùng qua
    // bước báo giá rồi vấp EXCLUDE (`SlotTakenError`), hoặc bên thắng đã ghi
    // xong trước khi bên thua báo giá (`SlotUnavailableError`). Điều KHÔNG được
    // xảy ra là hai bên cùng thắng.
    const race = await Promise.allSettled([hold("Người A"), hold("Người B")]);
    const winners = race.filter((result) => result.status === "fulfilled");
    const losers = race.filter((result) => result.status === "rejected");

    report(
      "hai request đồng thời: đúng MỘT bên thắng",
      winners.length === 1 && losers.length === 1,
      `thắng ${winners.length}, thua ${losers.length}`,
    );
    const loserError: unknown = losers[0]?.reason;
    report(
      "bên thua nhận SlotTakenError hoặc SlotUnavailableError",
      loserError instanceof SlotTakenError || loserError instanceof SlotUnavailableError,
      errorName(loserError),
    );

    const liveOnCourt1 = await db.booking.count({
      where: { courtId: court1.id, status: { in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] } },
    });
    report("database chỉ có 1 lượt còn sống", liveOnCourt1 === 1, `${liveOnCourt1} lượt`);

    // 2. Khung GỐI ĐẦU cũng phải bị chặn, không chỉ khung trùng khít.
    const overlapping = await outcomeOf(() => hold("Người C", 20 * 60, 22 * 60));
    report("khung gối đầu 20:00–22:00 bị chặn", overlapping !== "CHO QUA", overlapping);

    // 3. Huỷ rồi thì khung phải bán lại được — ràng buộc chỉ tính trạng thái còn sống.
    const winnerId = (winners[0] as PromiseFulfilledResult<{ id: string }> | undefined)?.value.id;
    if (!winnerId) throw new Error("Kịch bản 1 không có bên thắng — dừng các kịch bản sau");

    const cancelled = await bookings.cancel(winnerId, {
      actor: "VENUE",
      venueId: venue.id,
      reason: "kiểm tra",
    });
    const rebooked = await hold("Người D");
    report("huỷ xong bán lại được", rebooked.status === "HOLDING", `mã mới ${rebooked.code}`);
    report(
      "huỷ sớm thì trong hạn miễn phí; chưa trả tiền thì không có gì để hoàn",
      cancelled.refundable && cancelled.refundableAmount === 0,
      `freeUntil ${cancelled.freeUntil.toISOString()}, hoàn ${cancelled.refundableAmount}đ`,
    );

    // 4. Đổi giờ: nhả khung cũ rồi giữ khung mới gối lên chính nó (cùng giá).
    const moved = await bookings.reschedule({
      bookingId: rebooked.id,
      venueId: venue.id,
      courtId: court1.id,
      date: tomorrow,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
    });
    report(
      "đổi sang khung GỐI LÊN chính nó",
      moved.slotCount === 4 && moved.status === "HOLDING",
      `${moved.slotCount} khung, ${moved.total.toLocaleString("vi-VN")}đ`,
    );

    // 5. Hết hạn giữ chỗ.
    // Chỉ trong sân kiểm tra: gọi không giới hạn là nhả luôn chỗ đang giữ của
    // người đang dùng app trên cùng database này.
    const expiredCount = await bookings.expireHolds({
      now: new Date(Date.now() + 60 * 60_000),
      venueId: venue.id,
    });
    const stillLive = await db.booking.count({
      where: { courtId: court1.id, status: { in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] } },
    });
    report(
      "cron nhả hết chỗ quá hạn",
      expiredCount >= 1 && stillLive === 0,
      `nhả ${expiredCount}, còn ${stillLive}`,
    );

    // ---------------------------------------------------------------------
    // Phần hai: chốt chặn TIỀN
    // ---------------------------------------------------------------------

    const paidBooking = await hold("Người E", 8 * 60, 9 * 60);

    // 6. Khách bấm "Tạo mã chuyển khoản" hai lần cùng lúc — chỉ được một giao dịch sống.
    const [paymentA, paymentB] = await Promise.all([
      payments.start({ bookingId: paidBooking.id, provider: "BANK_TRANSFER" }),
      payments.start({ bookingId: paidBooking.id, provider: "BANK_TRANSFER" }),
    ]);
    const livePayments = await db.payment.count({
      where: { bookingId: paidBooking.id, status: { in: ["PENDING", "AWAITING_CONFIRMATION"] } },
    });
    report(
      "bấm thanh toán hai lần chỉ ra một giao dịch",
      livePayments === 1 && paymentA.id === paymentB.id,
      `${livePayments} giao dịch, id ${paymentA.id === paymentB.id ? "trùng" : "KHÁC"}`,
    );

    // 7. Khai đã chuyển rồi thì KHÔNG đổi sang VNPay được: huỷ giao dịch đang chờ
    // duyệt là vứt lời khai về một khoản tiền có thể đã về; mở thêm là thu hai lần.
    const transfer = paymentA;
    await payments.declareTransfer({ paymentIds: [transfer.id], note: "kiểm tra" });
    const switchProvider = await outcomeOf(() =>
      payments.start({ bookingId: paidBooking.id, provider: "VNPAY" }),
    );
    const liveAfterSwitch = await db.payment.count({
      where: { bookingId: paidBooking.id, status: { in: ["PENDING", "AWAITING_CONFIRMATION"] } },
    });
    report(
      "khai chuyển khoản rồi thì không mở thêm giao dịch VNPay",
      switchProvider === "BookingStateError" && liveAfterSwitch === 1,
      `${switchProvider}, ${liveAfterSwitch} giao dịch sống`,
    );

    // 8. Mã QR VietQR dựng từ tài khoản của sân.
    const instruction = await payments.transferInstruction([transfer.id]);
    report(
      "dựng được mã QR chuyển khoản",
      instruction.qrPayload !== null && instruction.transferNote === `CS ${paidBooking.code}`,
      `nội dung "${instruction.transferNote}", QR ${instruction.qrPayload?.length ?? 0} ký tự`,
    );

    // 9. Chủ sân duyệt → lượt đặt tự chuyển sang CONFIRMED.
    await payments.approveManual({
      paymentIds: [transfer.id],
      venueId: venue.id,
      reviewerId: "kiem-tra",
    });
    const afterApproval = await db.booking.findUniqueOrThrow({ where: { id: paidBooking.id } });
    report(
      "duyệt tay xong lượt đặt tự thành CONFIRMED",
      afterApproval.status === "CONFIRMED" && afterApproval.holdExpiresAt === null,
      `${afterApproval.status}, holdExpiresAt ${afterApproval.holdExpiresAt === null ? "đã xoá" : "CÒN"}`,
    );

    // 10. Webhook gửi lại cùng một sự kiện — không được xử lý lần nữa.
    const gatewayBooking = await hold("Người F", 9 * 60, 10 * 60);
    const gatewayPayment = await payments.start({
      bookingId: gatewayBooking.id,
      provider: "VNPAY",
    });
    const webhook = {
      provider: "VNPAY" as const,
      externalEventId: `evt-${suffix}`,
      merchantRef: gatewayPayment.merchantRef,
      succeeded: true,
      amount: gatewayPayment.amount,
      payload: { test: true },
      verified: true,
    };

    const firstDelivery = await payments.handleWebhook(webhook);
    const secondDelivery = await payments.handleWebhook(webhook);
    report(
      "webhook gửi lại không xác nhận lần hai",
      firstDelivery.handled && !secondDelivery.handled,
      `lần 1 ${firstDelivery.handled ? "xử lý" : "bỏ"}, lần 2 ${secondDelivery.handled ? "XỬ LÝ LẠI — SAI" : `bỏ (${secondDelivery.reason})`}`,
    );

    // 11. Cổng báo về số tiền khác — dừng, KHÔNG ném lỗi, và ghi sự kiện cùng
    // trạng thái FAILED trong một transaction (lần gửi lại vẫn thấy lý do).
    const mismatchBooking = await hold("Người G", 10 * 60, 11 * 60);
    const mismatchPayment = await payments.start({
      bookingId: mismatchBooking.id,
      provider: "MOMO",
    });
    const mismatchEventId = `evt-lech-${suffix}`;
    const mismatch = await payments.handleWebhook({
      provider: "MOMO",
      externalEventId: mismatchEventId,
      merchantRef: mismatchPayment.merchantRef,
      succeeded: true,
      amount: 1_000,
      payload: {},
      verified: true,
    });
    const [mismatchPaymentAfter, mismatchBookingAfter, mismatchEvents] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: mismatchPayment.id } }),
      db.booking.findUniqueOrThrow({ where: { id: mismatchBooking.id } }),
      db.paymentEvent.count({ where: { provider: "MOMO", externalEventId: mismatchEventId } }),
    ]);
    report(
      "cổng báo lệch tiền: không xác nhận, giao dịch FAILED kèm lý do, sự kiện đã ghi",
      mismatch.amountMismatch?.received === 1_000 &&
        mismatchPaymentAfter.status === "FAILED" &&
        mismatchBookingAfter.status === "HOLDING" &&
        mismatchEvents === 1,
      `giao dịch ${mismatchPaymentAfter.status} (${mismatchPaymentAfter.failReason}), lượt đặt ${mismatchBookingAfter.status}, ${mismatchEvents} sự kiện`,
    );

    // ---------------------------------------------------------------------
    // Phần ba: MỘT LẦN ĐẶT NHIỀU LƯỢT và CHỖ GIỮ QUÁ HẠN
    //
    // Mock không chứng minh được hai thứ ở đây: transaction cuộn lại THẬT khi
    // ràng buộc EXCLUDE bắn giữa chừng, và Postgres cho giữ đè lên một chỗ giữ
    // quá hạn sau khi nó được nhả trong cùng transaction.
    // ---------------------------------------------------------------------

    const holdMany = (
      customerName: string,
      ranges: { courtId: string; startMinute: number; endMinute: number }[],
    ) =>
      bookings.holdCheckout({
        venueId: venue.id,
        date: tomorrow,
        ranges,
        customerName,
        customerPhone: "0900000000",
      });

    // 12. Hai sân một lần: chung mã lần đặt.
    const group = await holdMany("Người H", [
      { courtId: court1.id, startMinute: 12 * 60, endMinute: 13 * 60 },
      { courtId: court2.id, startMinute: 12 * 60, endMinute: 12 * 60 + 30 },
    ]);
    report(
      "đặt hai sân một lần: chung mã lần đặt",
      group.length === 2 && group.every((booking) => booking.checkoutCode === group[0]!.code),
      group.map((booking) => `${booking.code}→${booking.checkoutCode}`).join(", "),
    );

    // 13. Hai lần đặt nhiều lượt tranh cùng một dãy: bên thua KHÔNG được để lại
    // nửa lần đặt. Chạy đồng thời để có lúc cả hai cùng qua bước báo giá và bên
    // thua chỉ vấp ràng buộc EXCLUDE ở câu INSERT thứ hai — lúc đó transaction
    // phải cuộn lại cả lượt đầu. (Khoá dòng sân con khiến hai bên xếp hàng thay
    // vì chen nhau; kết quả phải vẫn như vậy.)
    const contest = await Promise.allSettled([
      holdMany("Người I", [
        { courtId: court1.id, startMinute: 14 * 60, endMinute: 15 * 60 },
        { courtId: court2.id, startMinute: 15 * 60, endMinute: 16 * 60 },
      ]),
      holdMany("Người K", [
        { courtId: court1.id, startMinute: 16 * 60, endMinute: 17 * 60 },
        { courtId: court2.id, startMinute: 15 * 60, endMinute: 16 * 60 },
      ]),
    ]);
    const contestWinners = contest.filter((result) => result.status === "fulfilled").length;
    const holdingByCustomer = await db.booking.groupBy({
      by: ["customerName"],
      where: { venueId: venue.id, customerName: { in: ["Người I", "Người K"] }, status: "HOLDING" },
      _count: true,
    });
    report(
      "tranh cùng dãy: bên thua không để lại nửa lần đặt",
      contestWinners === 1 && holdingByCustomer.length === 1 && holdingByCustomer[0]!._count === 2,
      holdingByCustomer.map((row) => `${row.customerName}: ${row._count} lượt`).join(", ") ||
        "không ai giữ được",
    );

    // 14. Chỗ giữ QUÁ HẠN mà cron chưa nhả: người sau vẫn đặt được.
    const staleHold = await hold("Người L", 18 * 60, 19 * 60);
    await db.booking.update({
      where: { id: staleHold.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    const overStale = await outcomeOf(() => hold("Người M", 18 * 60, 18 * 60 + 30));
    const staleAfter = await db.booking.findUniqueOrThrow({ where: { id: staleHold.id } });
    report(
      "chỗ giữ quá hạn không chặn người sau",
      overStale === "CHO QUA" && staleAfter.status === "EXPIRED",
      `${overStale === "CHO QUA" ? "đặt được" : `BỊ CHẶN: ${overStale}`}, chỗ cũ ${staleAfter.status}`,
    );

    // 15. Khách đã báo chuyển khoản thì cron KHÔNG được nhả chỗ.
    const declaredBooking = await hold("Người N", 7 * 60, 8 * 60);
    const declaredPayment = await payments.start({
      bookingId: declaredBooking.id,
      provider: "BANK_TRANSFER",
    });
    await payments.declareTransfer({ paymentIds: [declaredPayment.id] });
    // Đúng điều kiện của cron `expireHolds`, nhưng chỉ trên lượt này — gọi cron
    // thật với "một giờ sau" sẽ nhả luôn chỗ giữ của người khác trong database.
    const cronWouldRelease = await db.booking.count({
      where: {
        id: declaredBooking.id,
        status: "HOLDING",
        holdExpiresAt: { lte: new Date(Date.now() + 24 * 60 * 60_000) },
      },
    });
    report(
      "đã báo chuyển khoản thì cron không nhả chỗ",
      cronWouldRelease === 0,
      cronWouldRelease === 0 ? "hạn giữ chỗ đã được xoá" : "CRON SẼ NHẢ CHỖ CỦA KHÁCH ĐÃ TRẢ TIỀN",
    );

    // 16. Duyệt một lần cho cả nhóm — và sân khác thì không duyệt được.
    const groupPayments = await Promise.all(
      group.map((booking) => payments.start({ bookingId: booking.id, provider: "BANK_TRANSFER" })),
    );
    const groupInstruction = await payments.transferInstruction(
      groupPayments.map((payment) => payment.id),
    );
    await payments.declareTransfer({ paymentIds: groupPayments.map((payment) => payment.id) });

    const otherVenue = await outcomeOf(() =>
      payments.approveManual({
        paymentIds: groupPayments.map((payment) => payment.id),
        venueId: `san-khac-${suffix}`,
        reviewerId: "kiem-tra",
      }),
    );

    await payments.approveManual({
      paymentIds: groupPayments.map((payment) => payment.id),
      venueId: venue.id,
      reviewerId: "kiem-tra",
    });
    const groupAfter = await db.booking.findMany({
      where: { id: { in: group.map((booking) => booking.id) } },
    });
    report(
      "nhóm: một QR tổng tiền, một lần duyệt, sân khác không duyệt được",
      groupInstruction.amount === group[0]!.total + group[1]!.total &&
        groupInstruction.transferNote === `CS ${group[0]!.code}` &&
        otherVenue === "PaymentNotFoundError" &&
        groupAfter.every((booking) => booking.status === "CONFIRMED"),
      `QR ${groupInstruction.amount.toLocaleString("vi-VN")}đ "${groupInstruction.transferNote}", sân khác: ${otherVenue}, sau duyệt: ${groupAfter.map((booking) => booking.status).join("/")}`,
    );

    // ---------------------------------------------------------------------
    // Phần bốn: HOÀN TIỀN và TIỀN VỀ CHO LƯỢT KHÔNG CÒN GIỮ CHỖ
    //
    // Hai câu SQL chỉ database thật kiểm được: khoá dòng giao dịch (`FOR
    // UPDATE`) khi xin hoàn, và phép cộng `increment` khi hai lần đánh dấu "đã
    // hoàn" chạy cùng lúc.
    // ---------------------------------------------------------------------

    // 17. Giao dịch 120.000đ đã duyệt ở kịch bản 9.
    const refund = await payments.requestRefund({
      paymentId: transfer.id,
      amount: 50_000,
      reason: "kiểm tra",
      requestedBy: "kiem-tra",
    });
    const overRefund = await outcomeOf(() =>
      payments.requestRefund({
        paymentId: transfer.id,
        amount: 80_000,
        reason: "kiểm tra",
        requestedBy: "kiem-tra",
      }),
    );
    const settleRace = await Promise.allSettled([
      payments.settleRefund({ refundId: refund.id, approvedBy: "kiem-tra" }),
      payments.settleRefund({ refundId: refund.id, approvedBy: "kiem-tra" }),
    ]);
    const refundedPayment = await db.payment.findUniqueOrThrow({ where: { id: transfer.id } });
    report(
      "hoàn tiền: trừ cả khoản đang chờ; đánh dấu 'đã hoàn' hai lần cùng lúc không cộng hai lần",
      overRefund === "RefundAmountError" &&
        settleRace.every((result) => result.status === "fulfilled") &&
        refundedPayment.refundedAmount === 50_000 &&
        refundedPayment.status === "PARTIALLY_REFUNDED",
      `xin hoàn vượt: ${overRefund}, đã hoàn ${refundedPayment.refundedAmount}đ, ${refundedPayment.status}`,
    );

    // 18. Cổng báo tiền về cho lượt đã HẾT HẠN (giao dịch vẫn sống vì cron huỷ
    // giao dịch chưa chạy): ghi nhận tiền, không xác nhận lượt, tạo yêu cầu hoàn.
    const lateBooking = await hold("Người O", 11 * 60, 12 * 60);
    const latePayment = await payments.start({ bookingId: lateBooking.id, provider: "ZALOPAY" });
    await db.booking.update({
      where: { id: lateBooking.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await bookings.expireHolds({ now: new Date(), venueId: venue.id });
    const late = await payments.handleWebhook({
      provider: "ZALOPAY",
      externalEventId: `evt-muon-${suffix}`,
      merchantRef: latePayment.merchantRef,
      succeeded: true,
      amount: latePayment.amount,
      payload: {},
      verified: true,
    });
    const [latePaymentAfter, lateBookingAfter, lateRefunds] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: latePayment.id } }),
      db.booking.findUniqueOrThrow({ where: { id: lateBooking.id } }),
      db.refund.count({ where: { paymentId: latePayment.id, status: "PENDING" } }),
    ]);
    report(
      "tiền về cho lượt đã hết hạn: ghi tiền, không xác nhận, có yêu cầu hoàn",
      late.refundId !== undefined &&
        latePaymentAfter.status === "SUCCEEDED" &&
        lateBookingAfter.status === "EXPIRED" &&
        lateRefunds === 1,
      `giao dịch ${latePaymentAfter.status}, lượt đặt ${lateBookingAfter.status}, ${lateRefunds} yêu cầu hoàn`,
    );

    // ---------------------------------------------------------------------
    // Phần năm: TOÀN VẸN DỮ LIỆU và TRẦN do database chốt
    //
    // Mock không chứng minh được: khoá ngoại hai cột thật sự chặn, và các khoá
    // dòng (`FOR NO KEY UPDATE`) thật sự bắt hai thao tác đồng thời xếp hàng.
    // ---------------------------------------------------------------------

    // 19. Lượt đặt mang venue_id của cơ sở KHÁC với sân con: khoá ngoại hai cột
    // chặn ngay trong database, kể cả khi ai đó ghi thẳng không qua service.
    const foreignVenue = await db.venue.create({
      data: {
        slug: `${slug}-khac`,
        name: "Sân kiểm tra khác",
        sportId: sport.id,
        address: "2 Đường Test",
        ward: "Phường Cầu Giấy",
        province: "Hà Nội",
        status: "DRAFT",
      },
    });
    extraVenueIds.push(foreignVenue.id);

    const dayAgo = Date.now() - 3 * 24 * 60 * 60_000;
    const mismatchedVenue = await outcomeOf(() =>
      db.booking.create({
        data: {
          code: fakeBookingCode(),
          venueId: foreignVenue.id,
          courtId: court1.id,
          customerName: "Người P",
          customerPhone: "0900000000",
          startAt: new Date(dayAgo),
          endAt: new Date(dayAgo + 30 * 60_000),
          slotCount: 1,
          status: "CANCELLED",
          subtotal: 60_000,
          total: 60_000,
        },
      }),
    );
    report(
      "lượt đặt lệch cơ sở với sân con bị khoá ngoại chặn",
      mismatchedVenue !== "CHO QUA",
      mismatchedVenue,
    );

    // 20. Năm lần đăng ký cơ sở CÙNG LÚC của một người: trần 3 hồ sơ chờ duyệt
    // phải giữ được — đếm-rồi-tạo mà không khoá là cả năm cùng thấy "mới có 0".
    const tester = await db.user.create({
      data: { email: `kiem-tra-${suffix}@example.invalid` },
    });
    testUserId = tester.id;

    const venuesService = new VenueService(db);
    const drafts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        venuesService.create({
          // Tên khác nhau: trùng tên là đua slug — một chuyện khác, không phải thứ đang đo.
          name: `Sân thử trần ${index + 1} ${suffix}`,
          sportId: sport.id,
          address: "3 Đường Test",
          ward: "Phường Cầu Giấy",
          province: "Hà Nội",
          ownerId: tester.id,
        }),
      ),
    );
    for (const draft of drafts) {
      if (draft.status === "fulfilled") extraVenueIds.push(draft.value.id);
    }
    const unapproved = await db.venue.count({
      where: {
        status: { in: ["DRAFT", "PENDING"] },
        members: { some: { userId: tester.id, role: "OWNER" } },
      },
    });
    const limited = drafts.filter(
      (draft) => draft.status === "rejected" && draft.reason instanceof VenueDraftLimitError,
    ).length;
    report(
      "năm lần đăng ký cơ sở cùng lúc: đúng 3 hồ sơ chờ duyệt",
      unapproved === 3 && limited === 2,
      `${unapproved} hồ sơ, ${limited} lần bị chặn trần`,
    );

    // 21. Hai đánh giá CÙNG LÚC cho một cơ sở: không bên nào đè mất bên kia.
    // Lượt "đã chơi xong" ghi thẳng — luồng giữ chỗ không cho đặt giờ đã qua.
    const played = await Promise.all(
      [0, 2].map((offsetHours) =>
        db.booking.create({
          data: {
            code: fakeBookingCode(),
            venueId: venue.id,
            courtId: court2.id,
            userId: tester.id,
            customerName: "Người Q",
            customerPhone: "0900000000",
            startAt: new Date(dayAgo + offsetHours * 60 * 60_000),
            endAt: new Date(dayAgo + (offsetHours + 1) * 60 * 60_000),
            slotCount: 2,
            status: "CHECKED_IN",
            subtotal: 120_000,
            total: 120_000,
            checkedInAt: new Date(dayAgo + offsetHours * 60 * 60_000),
          },
        }),
      ),
    );
    const reviews = new ReviewService(db);
    const reviewRace = await Promise.allSettled([
      reviews.create({ bookingId: played[0]!.id, userId: tester.id, rating: 5 }),
      reviews.create({ bookingId: played[1]!.id, userId: tester.id, rating: 2 }),
    ]);
    const rated = await db.venue.findUniqueOrThrow({
      where: { id: venue.id },
      select: { ratingAvg: true, ratingCount: true },
    });
    report(
      "hai đánh giá cùng lúc: đếm đủ 2, trung bình 3.5",
      reviewRace.every((result) => result.status === "fulfilled") &&
        rated.ratingCount === 2 &&
        Number(rated.ratingAvg) === 3.5,
      `${rated.ratingCount} đánh giá, trung bình ${rated.ratingAvg.toString()}`,
    );
  } finally {
    const leftovers = [...(venueId ? [venueId] : []), ...extraVenueIds];
    for (const id of leftovers) {
      try {
        await cleanUp(id);
      } catch (error) {
        ok = false;
        console.error(
          `✗ Không dọn được dữ liệu kiểm tra — xoá tay cơ sở ${id} (slug bắt đầu "${slug}").`,
          error,
        );
      }
    }
    if (testUserId) {
      try {
        await db.user.delete({ where: { id: testUserId } });
      } catch (error) {
        ok = false;
        console.error(`✗ Không xoá được người dùng kiểm tra ${testUserId}.`, error);
      }
    }
    await db.$disconnect();
  }

  console.log(ok ? "\n✅ ĐẠT — database chặn được trùng chỗ và trùng tiền" : "\n❌ HỎNG");
  // `process.exit` nằm SAU `finally`: gọi nó bên trong `try` là thoát ngay, bỏ
  // qua phần dọn dữ liệu.
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
