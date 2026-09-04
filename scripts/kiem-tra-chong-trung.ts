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
 * Chạy được trên database nào cũng được: nó tự tạo sân riêng rồi tự xoá.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AvailabilityService } from "@/services/availability.service";
import { BookingService } from "@/services/booking.service";
import { PaymentService } from "@/services/payment.service";
import { PaymentAmountMismatchError, SlotTakenError } from "@/lib/errors";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // -----------------------------------------------------------------------
  // Phần không: RÀNG BUỘC VIẾT TAY CÒN NGUYÊN KHÔNG
  //
  // `prisma migrate diff` đòi xoá mọi index/ràng buộc không có trong
  // schema.prisma, và nếu ai đó áp thẳng SQL nó sinh ra thì chúng biến mất
  // trong im lặng — test vẫn xanh, chỉ có chống trùng chỗ và chống trùng tiền
  // là không còn. Xem GOTCHAS #11. Đây là chốt chặn cuối cho chuyện đó.
  // -----------------------------------------------------------------------
  const CAN_GIU = [
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
  ];

  const daCo = new Set(
    (
      await db.$queryRawUnsafe<{ ten: string }[]>(
        `select indexname as ten from pg_indexes where schemaname = 'public'
         union select conname as ten from pg_constraint`,
      )
    ).map((row) => row.ten),
  );

  const thieu = CAN_GIU.filter((ten) => !daCo.has(ten));

  const suffix = Date.now().toString(36);

  const sport = await db.sport.upsert({
    where: { key: "badminton" },
    update: {},
    create: { key: "badminton", name: "Cầu lông" },
  });

  const venue = await db.venue.create({
    data: {
      slug: `kiem-tra-${suffix}`,
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
      courts: { create: [{ name: "Sân 1", sortOrder: 1, isActive: true, sportId: sport.id }] },
      priceRules: {
        create: [
          { weekdays: [], startMinute: 0, endMinute: 24 * 60, pricePerSlot: 60_000, priority: 0 },
        ],
      },
    },
    include: { courts: true },
  });

  const court = venue.courts[0]!;
  const service = new BookingService(db, new AvailabilityService(db));
  const ngayMai = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const dat = (ten: string, start = 19 * 60, end = 21 * 60) =>
    service.hold({
      venueId: venue.id,
      courtId: court.id,
      date: ngayMai,
      startMinute: start,
      endMinute: end,
      customerName: ten,
      customerPhone: "0900000000",
    });

  let ok = true;
  const bao = (nhan: string, dat_: boolean, chiTiet: string) => {
    if (!dat_) ok = false;
    console.log(`${dat_ ? "✓" : "✗"} ${nhan} — ${chiTiet}`);
  };

  bao(
    `${CAN_GIU.length} ràng buộc viết tay còn nguyên`,
    thieu.length === 0,
    thieu.length === 0 ? "không mất cái nào" : `MẤT: ${thieu.join(", ")}`,
  );

  // 1. ĐỒNG THỜI, không tuần tự: cả hai đều thấy "còn trống" ở bước kiểm.
  const ketQua = await Promise.allSettled([dat("Người A"), dat("Người B")]);
  const thang = ketQua.filter((r) => r.status === "fulfilled");
  const thua = ketQua.filter((r) => r.status === "rejected");

  bao(
    "hai request đồng thời",
    thang.length === 1 && thua.length === 1,
    `thắng ${thang.length}, thua ${thua.length}`,
  );
  const loiCuaNguoiThua: unknown = thua[0]?.reason;
  bao(
    "người thua nhận SlotTakenError",
    loiCuaNguoiThua instanceof SlotTakenError,
    loiCuaNguoiThua instanceof Error ? loiCuaNguoiThua.constructor.name : String(loiCuaNguoiThua),
  );

  const dangGiu = await db.booking.count({
    where: { courtId: court.id, status: { in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] } },
  });
  bao("database chỉ có 1 lượt còn sống", dangGiu === 1, `${dangGiu} lượt`);

  // 2. Khung GỐI ĐẦU cũng phải bị chặn, không chỉ khung trùng khít.
  let goiDau = "CHO QUA";
  try {
    await dat("Người C", 20 * 60, 22 * 60);
  } catch (error) {
    goiDau = error instanceof Error ? error.constructor.name : String(error);
  }
  bao("khung gối đầu 20:00–22:00 bị chặn", goiDau !== "CHO QUA", goiDau);

  // 3. Huỷ rồi thì khung phải bán lại được — ràng buộc chỉ tính trạng thái còn sống.
  const idThang = (thang[0] as PromiseFulfilledResult<{ id: string }>).value.id;
  const huy = await service.cancel(idThang, { reason: "kiểm tra" });
  const datLai = await dat("Người D");
  bao("huỷ xong bán lại được", datLai.status === "HOLDING", `mã mới ${datLai.code}`);
  bao("huỷ sớm thì được hoàn tiền", huy.refundable, `freeUntil ${huy.freeUntil.toISOString()}`);

  // 4. Đổi giờ: nhả khung cũ rồi giữ khung mới gối lên chính nó.
  const doiGio = await service.reschedule({
    bookingId: datLai.id,
    courtId: court.id,
    date: ngayMai,
    startMinute: 20 * 60,
    endMinute: 22 * 60,
  });
  bao(
    "đổi sang khung GỐI LÊN chính nó",
    doiGio.slotCount === 4 && doiGio.status === "HOLDING",
    `${doiGio.slotCount} khung, ${doiGio.total.toLocaleString("vi-VN")}đ`,
  );

  // 5. Hết hạn giữ chỗ.
  const soHetHan = await service.expireHolds({ now: new Date(Date.now() + 60 * 60_000) });
  const conSong = await db.booking.count({
    where: { courtId: court.id, status: { in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] } },
  });
  bao(
    "cron nhả hết chỗ quá hạn",
    soHetHan >= 1 && conSong === 0,
    `nhả ${soHetHan}, còn ${conSong}`,
  );

  // ---------------------------------------------------------------------
  // Phần hai: chốt chặn TIỀN
  // ---------------------------------------------------------------------

  const thanhToan = new PaymentService(db);
  const luot = await dat("Người E", 8 * 60, 9 * 60);

  // 6. Khách bấm "Thanh toán" hai lần cùng lúc — chỉ được một giao dịch sống.
  const [gdA, gdB] = await Promise.all([
    thanhToan.start({ bookingId: luot.id, provider: "BANK_TRANSFER" }),
    thanhToan.start({ bookingId: luot.id, provider: "BANK_TRANSFER" }),
  ]);
  const soGiaoDichSong = await db.payment.count({
    where: { bookingId: luot.id, status: { in: ["PENDING", "AWAITING_CONFIRMATION"] } },
  });
  bao(
    "bấm thanh toán hai lần chỉ ra một giao dịch",
    soGiaoDichSong === 1 && gdA.id === gdB.id,
    `${soGiaoDichSong} giao dịch, id ${gdA.id === gdB.id ? "trùng" : "KHÁC"}`,
  );

  // 7. Khai đã chuyển rồi vẫn mở được giao dịch VNPay = thu tiền hai lần.
  const gd = gdA;
  await thanhToan.declareTransfer({ paymentId: gd.id, note: "kiểm tra" });
  const gdThuHai = await thanhToan.start({ bookingId: luot.id, provider: "VNPAY" });
  bao(
    "khai chuyển khoản rồi thì không mở thêm giao dịch VNPay",
    gdThuHai.id === gd.id,
    gdThuHai.id === gd.id ? "trả về giao dịch đang chờ duyệt" : "TẠO THÊM GIAO DỊCH — SAI",
  );

  // 8. Mã QR VietQR dựng từ tài khoản của sân.
  const chiDan = await thanhToan.transferInstruction(gd.id);
  bao(
    "dựng được mã QR chuyển khoản",
    chiDan.qrPayload !== null && chiDan.transferNote === `CS ${luot.code}`,
    `nội dung "${chiDan.transferNote}", QR ${chiDan.qrPayload?.length ?? 0} ký tự`,
  );

  // 9. Chủ sân duyệt → lượt đặt tự chuyển sang CONFIRMED.
  await thanhToan.approveManual({ paymentId: gd.id, reviewerId: "kiem-tra" });
  const sauDuyet = await db.booking.findUniqueOrThrow({ where: { id: luot.id } });
  bao(
    "duyệt tay xong lượt đặt tự thành CONFIRMED",
    sauDuyet.status === "CONFIRMED" && sauDuyet.holdExpiresAt === null,
    `${sauDuyet.status}, holdExpiresAt ${sauDuyet.holdExpiresAt === null ? "đã xoá" : "CÒN"}`,
  );

  // 10. Webhook gửi lại cùng một sự kiện — không được xử lý lần nữa.
  const luot2 = await dat("Người F", 9 * 60, 10 * 60);
  const gdCong = await thanhToan.start({ bookingId: luot2.id, provider: "VNPAY" });
  const webhook = {
    provider: "VNPAY" as const,
    externalEventId: `evt-${suffix}`,
    merchantRef: gdCong.merchantRef,
    succeeded: true,
    amount: gdCong.amount,
    payload: { test: true },
    verified: true,
  };

  const lan1 = await thanhToan.handleWebhook(webhook);
  const lan2 = await thanhToan.handleWebhook(webhook);
  bao(
    "webhook gửi lại không xác nhận lần hai",
    lan1.handled && !lan2.handled,
    `lần 1 ${lan1.handled ? "xử lý" : "bỏ"}, lần 2 ${lan2.handled ? "XỬ LÝ LẠI — SAI" : `bỏ (${lan2.reason})`}`,
  );

  // 11. Cổng báo về số tiền khác — phải dừng, kể cả khi nói "thành công".
  const luot3 = await dat("Người G", 10 * 60, 11 * 60);
  const gdLech = await thanhToan.start({ bookingId: luot3.id, provider: "MOMO" });
  let lechTien = "CHO QUA";
  try {
    await thanhToan.handleWebhook({
      provider: "MOMO",
      externalEventId: `evt-lech-${suffix}`,
      merchantRef: gdLech.merchantRef,
      succeeded: true,
      amount: 1_000,
      payload: {},
      verified: true,
    });
  } catch (error) {
    lechTien =
      error instanceof PaymentAmountMismatchError ? "PaymentAmountMismatchError" : "lỗi khác";
  }
  const luot3Sau = await db.booking.findUniqueOrThrow({ where: { id: luot3.id } });
  bao(
    "cổng báo lệch tiền thì không xác nhận",
    lechTien === "PaymentAmountMismatchError" && luot3Sau.status === "HOLDING",
    `${lechTien}, lượt đặt vẫn ${luot3Sau.status}`,
  );

  // Dọn: xoá theo đúng thứ tự khoá ngoại.
  const idLuot = await db.booking.findMany({
    where: { venueId: venue.id },
    select: { id: true },
  });
  const idGiaoDich = await db.payment.findMany({
    where: { bookingId: { in: idLuot.map((b) => b.id) } },
    select: { id: true },
  });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: idGiaoDich.map((p) => p.id) } } });
  await db.refund.deleteMany({ where: { paymentId: { in: idGiaoDich.map((p) => p.id) } } });
  await db.payment.deleteMany({ where: { bookingId: { in: idLuot.map((b) => b.id) } } });
  await db.booking.deleteMany({ where: { venueId: venue.id } });
  await db.venue.delete({ where: { id: venue.id } });

  console.log(ok ? "\n✅ ĐẠT — database chặn được trùng chỗ và trùng tiền" : "\n❌ HỎNG");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
