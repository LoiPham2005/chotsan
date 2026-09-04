import Link from "next/link";
import { khoaNgay, nhanNgay, themNgay } from "@/lib/ngay";

/**
 * Dải 14 ngày để chọn.
 *
 * Là LINK chứ không phải nút JavaScript: mỗi ngày có URL riêng nên gửi cho bạn
 * bè được ("sân này, tối thứ 7"), nút quay lại hoạt động đúng, và trang đổi
 * ngày được cả khi JavaScript chưa tải xong.
 *
 * Cuộn ngang trên điện thoại. KHÔNG rút xuống 7 ngày ở khổ nhỏ: người đặt sân
 * hay đặt cho cuối tuần sau, mà 7 ngày thì không với tới.
 */
export function DaiChonNgay({
  basePath,
  ngayDangChon,
  soNgay = 14,
  homNay = new Date(),
}: {
  basePath: string;
  ngayDangChon: Date;
  soNgay?: number;
  homNay?: Date;
}) {
  const dangChon = khoaNgay(ngayDangChon);
  const khoaHomNay = khoaNgay(homNay);

  const ngay = Array.from({ length: soNgay }, (_, index) => themNgay(homNay, index));

  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      role="group"
      aria-label="Chọn ngày"
    >
      {ngay.map((item) => {
        const khoa = khoaNgay(item);
        const nhan = nhanNgay(item);
        const laHomNay = khoa === khoaHomNay;
        const duocChon = khoa === dangChon;

        return (
          <Link
            key={khoa}
            href={`${basePath}?ngay=${khoa}`}
            scroll={false}
            aria-current={duocChon ? "date" : undefined}
            className={`flex min-w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-token-md border px-3 py-2 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              duocChon
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-content hover:border-brand-line hover:bg-brand-tint"
            }`}
          >
            <span className={`text-xs ${duocChon ? "text-white/80" : "text-muted"}`}>
              {laHomNay ? "Hôm nay" : nhan.thu}
            </span>
            <span className="text-sm font-semibold">{nhan.ngay}</span>
          </Link>
        );
      })}
    </div>
  );
}
