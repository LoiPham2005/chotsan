import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * Trang chủ — cũng là trang mẫu cho lối viết giao diện của dự án.
 *
 * Dùng class tiện ích của Tailwind với TOKEN của dự án (`bg-surface`,
 * `text-muted`…), không dùng `style={{}}` nội tuyến như bản trước. Lý do không
 * chỉ là gọn: `style` nội tuyến buộc CSP phải mở `style-src 'unsafe-inline'`
 * (xem ghi chú trong `src/proxy.ts`). Càng ít inline style, càng gần tới ngày
 * siết được dòng đó.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand ring-1 ring-inset ring-brand/30">
          Next.js 16 + Prisma
        </span>

        <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-content sm:text-5xl">
          Bộ khung web có sẵn xác thực và phân quyền
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          App Router + Prisma + Zod trong một dự án phẳng. Đăng nhập, RBAC sửa được lúc chạy, REST
          API cho mobile và WebSocket đều đã dựng sẵn.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <>
              <Button asChild size="lg">
                <Link href="/users">Vào khu quản trị</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/security">Bảo mật tài khoản</Link>
              </Button>
            </>
          ) : (
            <Button asChild size="lg">
              <Link href="/login">Đăng nhập</Link>
            </Button>
          )}
          <Button asChild size="lg" variant="outline">
            <Link href="/docs">Tài liệu API</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className="rounded-token-lg border border-line bg-surface p-6 transition-colors hover:border-brand/40"
          >
            <h2 className="text-base font-semibold text-content">{feature.title}</h2>
            <p className="mt-1 font-mono text-xs text-brand">{feature.path}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

const FEATURES = [
  {
    title: "Xác thực & phiên đăng nhập",
    path: "src/lib/session.ts · src/lib/auth.ts",
    description:
      "Mật khẩu băm Argon2id tự nâng cấp dần từ bcrypt, khoá tài khoản khi sai liên tiếp, refresh token xoay vòng và thu hồi được.",
  },
  {
    title: "Phân quyền sửa được lúc chạy",
    path: "src/services/role.service.ts · /roles",
    description:
      "Danh mục quyền nằm trong code để TypeScript bắt lỗi; việc gán quyền nằm trong database để đổi mà không cần deploy.",
  },
  {
    title: "Tầng nghiệp vụ tách bạch",
    path: "src/services/",
    description:
      "Nơi duy nhất gọi Prisma. Web và REST API dùng chung một tầng, nên không có luật nghiệp vụ nào chỉ tồn tại ở một phía.",
  },
  {
    title: "REST API cho mobile",
    path: "src/app/api/v1/",
    description:
      "Bearer token, envelope JSON thống nhất, đặc tả OpenAPI sinh thẳng từ Zod schema nên không bao giờ lệch tài liệu.",
  },
  {
    title: "Realtime tách tiến trình",
    path: "realtime/",
    description:
      "WebSocket chạy riêng, dùng chung token với web và mobile. Deploy web không làm rớt kết nối đang mở.",
  },
  {
    title: "Sẵn sàng triển khai",
    path: "Dockerfile · deploy/",
    description:
      "Image standalone, systemd unit đã siết quyền, Caddy tự cấp HTTPS, CI tự build và chạy thử container.",
  },
];
