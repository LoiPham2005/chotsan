import type { PrismaClient } from "@prisma/client";

/**
 * Danh mục môn thể thao. Chạy ở MỌI môi trường, kể cả production.
 *
 * Đây là dữ liệu nền chứ không phải dữ liệu mẫu: không có dòng nào ở đây thì
 * không tạo được cơ sở nào, vì `Venue.sportId` là bắt buộc.
 */
const MON_THE_THAO = [
  { key: "badminton", name: "Cầu lông", sortOrder: 1 },
  { key: "football", name: "Bóng đá", sortOrder: 2 },
  { key: "pickleball", name: "Pickleball", sortOrder: 3 },
  { key: "tennis", name: "Tennis", sortOrder: 4 },
  { key: "basketball", name: "Bóng rổ", sortOrder: 5 },
  { key: "volleyball", name: "Bóng chuyền", sortOrder: 6 },
  { key: "table-tennis", name: "Bóng bàn", sortOrder: 7 },
];

export async function seedMonTheThao(prisma: PrismaClient): Promise<void> {
  for (const mon of MON_THE_THAO) {
    await prisma.sport.upsert({
      where: { key: mon.key },
      // Cập nhật tên và thứ tự, KHÔNG đụng `isActive`: admin tắt một môn rồi
      // thì lần deploy sau không được tự bật lại.
      update: { name: mon.name, sortOrder: mon.sortOrder },
      create: mon,
    });
  }

  console.log(`✓ Đã đồng bộ ${MON_THE_THAO.length} môn thể thao`);
}
