import type { PrismaClient } from "@prisma/client";

/**
 * Ba cơ sở mẫu cho môi trường DEV — đủ để mở màn nào cũng có thứ để nhìn.
 *
 * ---
 * VÌ SAO PHẢI CÓ DỮ LIỆU MẪU TỬ TẾ, KHÔNG PHẢI MỘT SÂN TRỐNG
 *
 * Lưới sân × khung giờ chỉ lộ ra lỗi khi có ĐỦ THỨ chồng lên nhau: sân đang
 * bảo trì, khung đã có người đặt, giờ vàng giá khác, sân tắt tạm. Một cơ sở
 * một sân con thì mọi ô đều xanh và nhìn cái gì cũng thấy đúng.
 *
 * ---
 * MỌI THỨ Ở ĐÂY PHẢI CHẠY LẠI ĐƯỢC
 *
 * Nhận diện theo `slug`, có rồi thì bỏ qua. Không xoá-rồi-tạo-lại: chạy seed
 * lần hai sẽ thổi bay lượt đặt mà người đang test vừa tạo bằng tay.
 */

const GIO_MO_CUA = { openMinute: 5 * 60 + 30, closeMinute: 23 * 60 };

type SanMau = {
  slug: string;
  name: string;
  sportKey: string;
  address: string;
  ward: string;
  province: string;
  description: string;
  amenities: string[];
  soSanCon: number;
  tenSanCon: (index: number) => string;
  isIndoor: boolean;
  surface: "WOOD" | "ARTIFICIAL_GRASS" | "CONCRETE" | "RUBBER";
  giaThuong: number;
  giaVang: number;
  holdMinutes: number;
  freeCancelHours: number;
  cancelFeePercent: number;
};

const SAN_MAU: SanMau[] = [
  {
    slug: "cau-long-thanh-cong",
    name: "Nhà thi đấu Cầu lông Thành Công",
    sportKey: "badminton",
    address: "168 Thái Hà",
    ward: "Phường Láng Hạ",
    province: "Hà Nội",
    description:
      "Nhà thi đấu 10 sân tiêu chuẩn thi đấu, sàn gỗ, trần cao 9m, đèn LED chống chói. Có phòng thay đồ, gửi xe miễn phí.",
    amenities: ["Bãi đỗ xe", "Phòng thay đồ", "Căng tin", "Wifi", "Điều hoà", "Cho thuê vợt"],
    soSanCon: 10,
    tenSanCon: (i) => `Sân ${i}`,
    isIndoor: true,
    surface: "WOOD",
    giaThuong: 70_000,
    giaVang: 110_000,
    holdMinutes: 10,
    freeCancelHours: 2,
    cancelFeePercent: 100,
  },
  {
    slug: "san-bong-my-dinh",
    name: "Sân bóng đá Mỹ Đình",
    sportKey: "football",
    address: "Lô C2 Khu liên hợp thể thao",
    ward: "Phường Mỹ Đình",
    province: "Hà Nội",
    description:
      "4 sân cỏ nhân tạo 7 người, cỏ Hàn Quốc dày 5cm, đèn cao áp chơi được tới 23h. Có sân 5 người cho nhóm nhỏ.",
    amenities: ["Bãi đỗ xe", "Phòng thay đồ", "Nước uống", "Cho thuê áo bib", "Trọng tài"],
    soSanCon: 4,
    tenSanCon: (i) => `Sân ${String.fromCharCode(64 + i)}`,
    isIndoor: false,
    surface: "ARTIFICIAL_GRASS",
    giaThuong: 250_000,
    giaVang: 400_000,
    holdMinutes: 15,
    // Sân bóng thuê cả buổi, nhóm 14 người — huỷ sát giờ là mất trắng một buổi.
    freeCancelHours: 12,
    cancelFeePercent: 50,
  },
  {
    slug: "pickleball-quan-7",
    name: "Pickleball Arena Quận 7",
    sportKey: "pickleball",
    address: "25 Nguyễn Lương Bằng",
    ward: "Phường Tân Phú",
    province: "TP. Hồ Chí Minh",
    description:
      "6 sân pickleball mặt nhựa acrylic tiêu chuẩn quốc tế, 4 sân có mái che. Nhận đặt theo giờ và theo tháng.",
    amenities: ["Bãi đỗ xe", "Mái che", "Cho thuê vợt", "Huấn luyện viên", "Nước uống"],
    soSanCon: 6,
    tenSanCon: (i) => `Sân ${i}`,
    isIndoor: false,
    surface: "RUBBER",
    giaThuong: 120_000,
    giaVang: 180_000,
    holdMinutes: 10,
    freeCancelHours: 3,
    cancelFeePercent: 50,
  },
];

/** Giờ vàng: 17:00–22:00 mọi ngày, và cả ngày cuối tuần. */
function luatGia(san: SanMau) {
  return [
    // Giá nền, mọi khung, mọi ngày.
    {
      weekdays: [],
      startMinute: GIO_MO_CUA.openMinute,
      endMinute: GIO_MO_CUA.closeMinute,
      pricePerSlot: san.giaThuong,
      isPeak: false,
      priority: 0,
    },
    // Giờ vàng trong tuần.
    {
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 17 * 60,
      endMinute: 22 * 60,
      pricePerSlot: san.giaVang,
      isPeak: true,
      priority: 10,
    },
    // Cuối tuần: cả ngày tính giá vàng.
    {
      weekdays: [0, 6],
      startMinute: GIO_MO_CUA.openMinute,
      endMinute: GIO_MO_CUA.closeMinute,
      pricePerSlot: san.giaVang,
      isPeak: true,
      priority: 5,
    },
  ];
}

export async function seedSanMau(prisma: PrismaClient): Promise<void> {
  const chuSan = await prisma.user.findFirst({
    where: { email: "chusan@dev.local", deletedAt: null },
    select: { id: true },
  });
  const nhanVien = await prisma.user.findFirst({
    where: { email: "nhanvien@dev.local", deletedAt: null },
    select: { id: true },
  });

  if (!chuSan) {
    console.log("⏭️  Bỏ qua sân mẫu: chưa có tài khoản chusan@dev.local");
    return;
  }

  let daTao = 0;

  for (const san of SAN_MAU) {
    const daCo = await prisma.venue.findUnique({
      where: { slug: san.slug },
      select: { id: true },
    });
    if (daCo) continue;

    const sport = await prisma.sport.findUniqueOrThrow({
      where: { key: san.sportKey },
      select: { id: true },
    });

    await prisma.venue.create({
      data: {
        slug: san.slug,
        name: san.name,
        description: san.description,
        status: "ACTIVE",
        address: san.address,
        ward: san.ward,
        province: san.province,
        phone: "0987654321",
        amenities: san.amenities,
        bankName: "VCB",
        bankAccountNumber: "1234567890",
        bankAccountName: "NGUYEN VAN A",
        commissionRate: 8,
        holdMinutes: san.holdMinutes,
        freeCancelHours: san.freeCancelHours,
        cancelFeePercent: san.cancelFeePercent,
        sportId: sport.id,
        hours: {
          create: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            ...GIO_MO_CUA,
            isClosed: false,
          })),
        },
        courts: {
          create: Array.from({ length: san.soSanCon }, (_, index) => ({
            sportId: sport.id,
            name: san.tenSanCon(index + 1),
            surface: san.surface,
            isIndoor: san.isIndoor,
            sortOrder: index,
            // Sân cuối tắt sẵn: lưới đặt sân phải chứng minh được là nó bỏ qua
            // sân đang tắt, và chuyện đó chỉ thấy khi có một sân bị tắt.
            isActive: index < san.soSanCon - 1,
          })),
        },
        priceRules: { create: luatGia(san) },
        members: {
          create: [
            { userId: chuSan.id, role: "OWNER", status: "ACTIVE" },
            ...(nhanVien
              ? [
                  {
                    userId: nhanVien.id,
                    role: "STAFF" as const,
                    status: "ACTIVE" as const,
                    permissions: ["payment:confirm"],
                  },
                ]
              : []),
          ],
        },
      },
    });

    daTao += 1;
  }

  if (daTao === 0) {
    console.log("✓ Sân mẫu đã có sẵn, không tạo lại");
    return;
  }

  console.log(`✓ Đã tạo ${daTao} cơ sở mẫu (chủ sân: chusan@dev.local)`);
}
