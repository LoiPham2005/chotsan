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

const OPENING_HOURS = { openMinute: 5 * 60 + 30, closeMinute: 23 * 60 };

type SampleVenue = {
  slug: string;
  name: string;
  sportKey: string;
  address: string;
  ward: string;
  province: string;
  description: string;
  amenities: string[];
  courtCount: number;
  courtName: (index: number) => string;
  isIndoor: boolean;
  surface: "WOOD" | "ARTIFICIAL_GRASS" | "CONCRETE" | "RUBBER";
  basePrice: number;
  peakPrice: number;
  holdMinutes: number;
  freeCancelHours: number;
  cancelFeePercent: number;
};

const SAMPLE_VENUES: SampleVenue[] = [
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
    courtCount: 10,
    courtName: (i) => `Sân ${i}`,
    isIndoor: true,
    surface: "WOOD",
    basePrice: 70_000,
    peakPrice: 110_000,
    holdMinutes: 10,
    freeCancelHours: 2,
    cancelFeePercent: 100,
  },
  {
    slug: "court-bong-my-dinh",
    name: "Sân bóng đá Mỹ Đình",
    sportKey: "football",
    address: "Lô C2 Khu liên hợp thể thao",
    ward: "Phường Mỹ Đình",
    province: "Hà Nội",
    description:
      "4 sân cỏ nhân tạo 7 người, cỏ Hàn Quốc dày 5cm, đèn cao áp chơi được tới 23h. Có sân 5 người cho nhóm nhỏ.",
    amenities: ["Bãi đỗ xe", "Phòng thay đồ", "Nước uống", "Cho thuê áo bib", "Trọng tài"],
    courtCount: 4,
    courtName: (i) => `Sân ${String.fromCharCode(64 + i)}`,
    isIndoor: false,
    surface: "ARTIFICIAL_GRASS",
    basePrice: 250_000,
    peakPrice: 400_000,
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
    courtCount: 6,
    courtName: (i) => `Sân ${i}`,
    isIndoor: false,
    surface: "RUBBER",
    basePrice: 120_000,
    peakPrice: 180_000,
    holdMinutes: 10,
    freeCancelHours: 3,
    cancelFeePercent: 50,
  },
];

/** Giờ vàng: 17:00–22:00 mọi ngày, và cả ngày cuối tuần. */
function priceRules(court: SampleVenue) {
  return [
    // Giá nền, mọi khung, mọi ngày.
    {
      weekdays: [],
      startMinute: OPENING_HOURS.openMinute,
      endMinute: OPENING_HOURS.closeMinute,
      pricePerSlot: court.basePrice,
      isPeak: false,
      priority: 0,
    },
    // Giờ vàng trong tuần.
    {
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 17 * 60,
      endMinute: 22 * 60,
      pricePerSlot: court.peakPrice,
      isPeak: true,
      priority: 10,
    },
    // Cuối tuần: cả ngày tính giá vàng.
    {
      weekdays: [0, 6],
      startMinute: OPENING_HOURS.openMinute,
      endMinute: OPENING_HOURS.closeMinute,
      pricePerSlot: court.peakPrice,
      isPeak: true,
      priority: 5,
    },
  ];
}

export async function seedVenues(prisma: PrismaClient): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { email: "chusan@dev.local", deletedAt: null },
    select: { id: true },
  });
  const staff = await prisma.user.findFirst({
    where: { email: "nhanvien@dev.local", deletedAt: null },
    select: { id: true },
  });

  if (!owner) {
    console.log("⏭️  Bỏ qua sân mẫu: chưa có tài khoản chusan@dev.local");
    return;
  }

  let created = 0;

  for (const court of SAMPLE_VENUES) {
    const existing = await prisma.venue.findUnique({
      where: { slug: court.slug },
      select: { id: true },
    });
    if (existing) continue;

    const sport = await prisma.sport.findUniqueOrThrow({
      where: { key: court.sportKey },
      select: { id: true },
    });

    await prisma.venue.create({
      data: {
        slug: court.slug,
        name: court.name,
        description: court.description,
        status: "ACTIVE",
        address: court.address,
        ward: court.ward,
        province: court.province,
        phone: "0987654321",
        amenities: court.amenities,
        bankName: "VCB",
        bankAccountNumber: "1234567890",
        bankAccountName: "NGUYEN VAN A",
        commissionRate: 8,
        holdMinutes: court.holdMinutes,
        freeCancelHours: court.freeCancelHours,
        cancelFeePercent: court.cancelFeePercent,
        sportId: sport.id,
        hours: {
          create: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            ...OPENING_HOURS,
            isClosed: false,
          })),
        },
        courts: {
          create: Array.from({ length: court.courtCount }, (_, index) => ({
            sportId: sport.id,
            name: court.courtName(index + 1),
            surface: court.surface,
            isIndoor: court.isIndoor,
            sortOrder: index,
            // Sân cuối tắt sẵn: lưới đặt sân phải chứng minh được là nó bỏ qua
            // sân đang tắt, và chuyện đó chỉ thấy khi có một sân bị tắt.
            isActive: index < court.courtCount - 1,
          })),
        },
        priceRules: { create: priceRules(court) },
        members: {
          create: [
            { userId: owner.id, role: "OWNER", status: "ACTIVE" },
            ...(staff
              ? [
                  {
                    userId: staff.id,
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

    created += 1;
  }

  if (created === 0) {
    console.log("✓ Sân mẫu đã có sẵn, không tạo lại");
    return;
  }

  console.log(`✓ Đã tạo ${created} cơ sở mẫu (chủ sân: chusan@dev.local)`);
}
