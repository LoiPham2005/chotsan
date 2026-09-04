import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { seedRbac } from "./seeds/seed-rbac";
import { seedAdmin } from "./seeds/seed-admin";
import { seedDev } from "./seeds/seed-dev";
import { seedMonTheThao } from "./seeds/seed-mon-the-thao";
import { seedSanMau } from "./seeds/seed-san-mau";

/**
 * Chạy: `pnpm db:seed`
 *
 * ---
 * SEED PHẢI CHẠY LẠI ĐƯỢC NHIỀU LẦN
 *
 * Ràng buộc bắt buộc, không phải mong muốn: seed được gọi sau MỖI lần deploy,
 * nên một seed chỉ chạy được lần đầu sẽ làm hỏng lần deploy thứ hai. Mọi thao
 * tác ở đây đều là `upsert` hoặc `createMany` với `skipDuplicates`.
 *
 * ---
 * BA PHẦN, TÁCH THEO MỨC ĐỘ AN TOÀN
 *
 *   seedRbac       — quyền & vai trò. Chạy ở MỌI môi trường, kể cả production.
 *   seedMonTheThao — danh mục môn. Cũng chạy ở production: không có nó thì
 *                    không tạo được cơ sở nào.
 *   seedAdmin      — tài khoản quản trị đầu tiên, đọc từ ADMIN_EMAIL/ADMIN_PASSWORD.
 *   seedDev        — tài khoản mẫu có mật khẩu công khai. CHỈ dev.
 *   seedSanMau     — ba cơ sở mẫu kèm giờ, sân con, bảng giá. CHỈ dev.
 */
/*
 * Prisma 7 bỏ query engine Rust: `new PrismaClient()` KHÔNG có adapter sẽ ném
 * lỗi ngay khi khởi tạo, chứ không phải lúc truy vấn đầu tiên.
 *
 * Không dùng lại `src/lib/prisma.ts` được: file đó có `import "server-only"`,
 * thứ cố tình nổ khi chạy ngoài React Server Component — mà seed là script
 * Node thuần.
 */
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Thiếu DATABASE_URL — seed không biết nối tới database nào.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const isProduction = process.env.NODE_ENV === "production";

  console.log(`🌱 Seeding (NODE_ENV=${process.env.NODE_ENV ?? "development"})…`);

  await seedRbac(prisma);
  console.log("✓ Đã đồng bộ quyền và vai trò hệ thống");

  await seedMonTheThao(prisma);

  await seedAdmin(prisma);

  if (isProduction) {
    console.log("⏭️  Bỏ qua dữ liệu mẫu: đang ở production");
  } else {
    await seedDev(prisma);
    await seedSanMau(prisma);
  }

  console.log("🌱 Xong.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error);
    // Exit code khác 0 là thứ làm script deploy dừng lại. Không có dòng này thì
    // seed hỏng vẫn được coi là deploy thành công.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
