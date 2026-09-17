import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { VenuePhoto } from "@/components/venue/venue-photo";
import { requireUser } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Quản lý sân", robots: { index: false } };

/**
 * Nhãn trạng thái cơ sở — mỗi nhãn nói bằng CẢ màu LẪN chữ (SKILL.md §1, luật 4).
 *
 * Không nhãn nào màu cam: cam chỉ nói "giờ vàng, giá cao hơn". "Chờ duyệt" là
 * chờ NGƯỜI KHÁC làm, không có gì sai và không gấp — skill không có màu cho
 * "đang chờ", nên dùng nền trắng + viền ĐỨT NÉT xám: khác hẳn "Bản nháp" (nền
 * xám, viền liền) cả khi in đen trắng, và không mượn màu của nghĩa nào khác.
 */
const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  ACTIVE: {
    text: "Đang nhận đặt",
    className: "bg-brand-tint text-brand-text ring-1 ring-brand-line",
  },
  DRAFT: { text: "Bản nháp", className: "bg-elevated text-muted ring-1 ring-line" },
  PENDING: {
    text: "Chờ duyệt",
    className: "border border-dashed border-line-strong bg-surface text-content",
  },
  SUSPENDED: { text: "Tạm nghỉ", className: "bg-elevated text-muted ring-1 ring-line" },
  UNDER_MAINTENANCE: { text: "Đang sửa", className: "bg-elevated text-muted ring-1 ring-line" },
  ADMIN_LOCKED: {
    text: "Bị khoá",
    className: "bg-danger-tint text-danger-text ring-1 ring-danger-line",
  },
};

/** Hồ sơ chưa được duyệt — việc của chủ sân lúc này là hoàn tất hồ sơ, không phải xem lịch. */
const UNAPPROVED = ["DRAFT", "PENDING"];

/**
 * Danh sách cơ sở người này quản lý, và lối vào đăng ký cơ sở mới.
 *
 * Chỉ có MỘT sân thì vào thẳng — bắt bấm qua một màn chọn chỉ-có-một-lựa-chọn
 * là thêm một cú bấm mỗi ngày cho tuyệt đại đa số chủ sân. TRỪ khi có `?all=1`:
 * link "← Sân của bạn" từ bên trong một sân phải dừng lại ở đây, không thì nó
 * chuyển hướng ngược về đúng chỗ vừa rời đi — một vòng lặp, và người có một sân
 * không bao giờ tới được nút "Đăng ký cơ sở mới".
 *
 * Cơ sở chưa duyệt mở thẳng trang cài đặt (danh sách việc cần làm + nút gửi
 * duyệt) cho người có quyền sửa cơ sở — lịch của một sân chưa bán thì trống trơn.
 */
export default async function ManageHomePage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string | string[] }>;
}) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const venues = await venueService.listForUser(user.id);

  const editableUnapproved = new Set(
    (
      await Promise.all(
        venues
          .filter((venue) => UNAPPROVED.includes(venue.status))
          .map(async (venue) =>
            (await permissionService.canOnVenue(user.id, "venue:update", venue.id))
              ? venue.id
              : null,
          ),
      )
    ).filter((id): id is string => id !== null),
  );

  const entryPath = (venueId: string) =>
    editableUnapproved.has(venueId)
      ? (`/manage/${venueId}/settings` as const)
      : (`/manage/${venueId}` as const);

  if (venues.length === 1 && query.all !== "1") redirect(entryPath(venues[0]!.id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">Sân của bạn</h1>

      {venues.length === 0 ? (
        <div className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Bạn chưa quản lý sân nào</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Chủ sân mời bạn vào sân của họ, hoặc bạn tự đăng ký một sân mới để bắt đầu nhận đặt.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/manage/new">Đăng ký cơ sở mới</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/venues">Xem các sân đang hoạt động</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {venues.map((venue) => {
              const sport = sportStyle(venue.sport.key);
              const status = STATUS_LABEL[venue.status] ?? {
                text: venue.status,
                className: "bg-elevated text-muted ring-1 ring-line",
              };

              return (
                // `min-w-0`: ô của grid mặc định nở theo nội dung — tên sân dài
                // (dù đã `truncate`) đẩy rộng cả trang trên điện thoại. Đã đo:
                // tràn 42px ở 390px.
                <li key={venue.id} className="min-w-0">
                  <Link
                    href={entryPath(venue.id)}
                    className="flex items-center gap-3 rounded-token-lg border border-line bg-surface p-4 transition-colors hover:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {venue.images[0] ? (
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-token-md bg-elevated ring-1 ring-line">
                        <VenuePhoto src={venue.images[0].url} alt="" sizes="44px" />
                      </span>
                    ) : (
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-token-md ${sport.tint} ${sport.text}`}
                      >
                        <SportIcon sportKey={venue.sport.key} />
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-content">
                        {venue.name}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {venue.status === "DRAFT" && editableUnapproved.has(venue.id)
                          ? "Hoàn tất hồ sơ để gửi duyệt"
                          : `${venue.ward}, ${venue.province}`}
                      </span>
                    </span>

                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}
                    >
                      {status.text}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Đặt SAU danh sách: link đầu tiên dạng `/manage/…` trên trang phải là
              một cơ sở thật (`openFirstVenue` trong `e2e/helpers.ts` lấy id từ đó). */}
          <div className="mt-6 border-t border-line pt-4">
            <Button asChild variant="outline">
              <Link href="/manage/new">+ Đăng ký cơ sở mới</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
