import type { PrismaClient } from "@prisma/client";

/**
 * Ảnh minh hoạ cho ba cơ sở mẫu — CHỈ DÙNG Ở DEV (seed bỏ qua trên production).
 *
 * ---
 * VÌ SAO CÓ ẢNH MẪU
 *
 * Thẻ sân và trang chi tiết không có ảnh thì chỉ còn khối màu + biểu tượng:
 * đúng về kỹ thuật, nhưng không hình dung được sản phẩm thật trông ra sao khi
 * chủ sân tải ảnh lên. Ảnh mẫu để nhìn giao diện ở trạng thái THẬT của nó.
 *
 * ---
 * NGUỒN VÀ GIẤY PHÉP
 *
 * Mọi ảnh đều là CC0 1.0 (hiến tặng vào phạm vi công cộng) — dùng, sửa, phân
 * phối tự do, không bắt ghi nguồn. Tìm qua Openverse (api.openverse.org) với
 * bộ lọc `license=cc0`. Vẫn ghi lại nguồn gốc từng tệp: một ngày ai đó hỏi
 * "ảnh này lấy ở đâu" thì có câu trả lời, không phải đi đoán.
 *
 * Tệp đã thu nhỏ về tối đa 1280px, bỏ metadata, nằm ở `public/demo/venues/`.
 * Ảnh đi qua `next/image` nên trình duyệt nhận bản WebP đúng cỡ, không phải
 * tệp gốc.
 */
type DemoImage = { file: string; title: string; source: string };

const DEMO_VENUE_IMAGES: Record<string, DemoImage[]> = {
  "cau-long-thanh-cong": [
    {
      file: "badminton-1.jpg",
      title: "Badminton court view",
      source: "https://commons.wikimedia.org/wiki/File:Badminton_court_view.jpg",
    },
    {
      file: "badminton-2.jpg",
      title: "Badminton Schnuppertraining",
      source: "https://live.staticflickr.com/4917/32291742538_56459882cc_b.jpg",
    },
    {
      file: "badminton-3.jpg",
      title: "Schools badminton1",
      source: "https://commons.wikimedia.org/wiki/File:Schools_badminton1.jpg",
    },
    {
      file: "badminton-4.jpg",
      title: "TalTech Sports Hall",
      source: "https://commons.wikimedia.org/wiki/File:TalTech_Sports_Hall.jpg",
    },
  ],
  "san-bong-my-dinh": [
    {
      file: "football-1.jpg",
      title: "Good view of football pitch",
      source: "https://commons.wikimedia.org/wiki/File:Good_view_of_football_pitch.jpg",
    },
    {
      file: "football-2.jpg",
      title: "The K-Wonder football pitch in Bbunga Kawuku, Ggaba",
      source:
        "https://commons.wikimedia.org/wiki/File:The_K-Wonder_football_pitch_in_Bbunga_Kawuku,_Ggaba.jpg",
    },
    {
      file: "football-3.jpg",
      title: "Soccer Field (StockSnap 5FKA3VHPRW)",
      source: "https://stocksnap.io/photo/5FKA3VHPRW",
    },
    {
      file: "football-4.jpg",
      title: "Soccer Field (StockSnap FS8QBX48GP)",
      source: "https://stocksnap.io/photo/FS8QBX48GP",
    },
  ],
  "pickleball-quan-7": [
    {
      file: "pickleball-1.jpg",
      title: "Harry B. Anderson Tennis Center - Pickleball Courts 1-3",
      source:
        "https://commons.wikimedia.org/wiki/File:Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_1-3.jpg",
    },
    {
      file: "pickleball-2.jpg",
      title: "Pickleball court in La Crosse, Wisconsin 02",
      source:
        "https://commons.wikimedia.org/wiki/File:Pickleball_court_in_La_Crosse,_Wisconsin_02.jpg",
    },
    {
      file: "pickleball-3.jpg",
      title: "Day 210 - New Courts!",
      source: "https://live.staticflickr.com/65535/51344423273_ecd27c31b9_b.jpg",
    },
    {
      file: "pickleball-4.jpg",
      title: "Pickleballs",
      source: "https://commons.wikimedia.org/wiki/File:Pickleballs.jpg",
    },
  ],
};

/**
 * Gắn ảnh mẫu cho các cơ sở mẫu.
 *
 * CHẠY LẠI ĐƯỢC, và KHÔNG BAO GIỜ ghi đè: cơ sở nào đã có ảnh (kể cả ảnh chủ
 * sân tự tải lên khi đang thử) thì bỏ qua. Ảnh đầu tiên là ảnh bìa
 * (`isPrimary`) — thẻ sân ở trang tìm kiếm chỉ đọc ảnh bìa.
 */
export async function seedVenueImages(prisma: PrismaClient): Promise<void> {
  let added = 0;

  for (const [slug, images] of Object.entries(DEMO_VENUE_IMAGES)) {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      select: { id: true, _count: { select: { images: true } } },
    });

    if (!venue || venue._count.images > 0) continue;

    await prisma.venueImage.createMany({
      data: images.map((image, index) => ({
        venueId: venue.id,
        url: `/demo/venues/${image.file}`,
        isPrimary: index === 0,
        sortOrder: index,
      })),
    });

    added += 1;
  }

  console.log(
    added === 0
      ? "✓ Ảnh sân mẫu đã có sẵn, không thêm lại"
      : `✓ Đã gắn ảnh minh hoạ cho ${added} cơ sở mẫu`,
  );
}
