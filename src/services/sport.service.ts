import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Danh mục môn thể thao — dùng cho ô lọc và màn tạo cơ sở. */
export class SportService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listActive() {
    return this.db.sport.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, key: true, name: true },
    });
  }
}

export const sportService = new SportService();
