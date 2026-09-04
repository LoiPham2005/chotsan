import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { requireUser } from "@/lib/auth";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Quản lý sân", robots: { index: false } };

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  ACTIVE: { text: "Đang nhận đặt", className: "bg-brand-tint text-brand-hover ring-brand-line" },
  DRAFT: { text: "Bản nháp", className: "bg-elevated text-muted ring-line" },
  PENDING: { text: "Chờ duyệt", className: "bg-peak-tint text-peak-text ring-peak-line" },
  SUSPENDED: { text: "Tạm nghỉ", className: "bg-elevated text-muted ring-line" },
  UNDER_MAINTENANCE: { text: "Đang sửa", className: "bg-peak-tint text-peak-text ring-peak-line" },
  ADMIN_LOCKED: { text: "Bị khoá", className: "bg-red-50 text-red-700 ring-red-200" },
};

/**
 * Danh sách cơ sở người này quản lý.
 *
 * Chỉ có MỘT sân thì vào thẳng — bắt bấm qua một màn chọn chỉ-có-một-lựa-chọn
 * là thêm một cú bấm mỗi ngày cho tuyệt đại đa số chủ sân.
 */
export default async function ManageHomePage() {
  const user = await requireUser("/manage");
  const venues = await venueService.listForUser(user.id);

  if (venues.length === 1) redirect(`/manage/${venues[0]!.id}`);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">Sân của bạn</h1>

      {venues.length === 0 ? (
        <div className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Bạn chưa quản lý sân nào</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Chủ sân mời bạn vào sân của họ, hoặc bạn tự đăng ký một sân mới để bắt đầu nhận đặt.
          </p>
          <Button asChild className="mt-5">
            <Link href="/venues">Xem các sân đang hoạt động</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {venues.map((venue) => {
            const style = sportStyle(venue.sport.key);
            const status = STATUS_LABEL[venue.status] ?? {
              text: venue.status,
              className: "bg-elevated text-muted ring-line",
            };

            return (
              <li key={venue.id}>
                <Link
                  href={`/manage/${venue.id}`}
                  className="flex items-center gap-3 rounded-token-lg border border-line bg-surface p-4 shadow-nang-1 transition-all hover:-translate-y-0.5 hover:border-brand-line hover:shadow-nang-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-token-md bg-gradient-to-br ${style.nen} ${style.mau}`}
                  >
                    <SportIcon sportKey={venue.sport.key} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-content">{venue.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {venue.ward}, {venue.province}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${status.className}`}
                  >
                    {status.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
