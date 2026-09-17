import { formatVndShort } from "@/lib/slots";

/**
 * Cột doanh thu theo ngày.
 *
 * ---
 * VẼ BẰNG `div`, KHÔNG KÉO THƯ VIỆN BIỂU ĐỒ
 *
 * Đây là một dãy cột cùng thang đo — thứ CSS làm được bằng chiều cao phần trăm.
 * Kéo Recharts về cho việc này là thêm ~90KB JavaScript vào một trang mà toàn
 * bộ dữ liệu đã có sẵn ở máy chủ, và biến một Server Component thành Client.
 *
 * ---
 * CHIỀU CAO PHẦN TRĂM CẦN MỘT CHA CÓ CHIỀU CAO XÁC ĐỊNH
 *
 * Lỗi thật trước đây: khung ngoài `flex h-40 items-end`, mỗi cột là một `div`
 * `flex-1` KHÔNG có chiều cao, thanh bên trong mang `height: X%`. Với
 * `items-end` (không phải `stretch`), cột con cao theo nội dung — tức là "tự
 * động", không xác định — và CSS quy định phần trăm của một chiều cao không xác
 * định thì tính như `auto`: thanh rỗng cao 0px. Biểu đồ có khung, có trục, không
 * có cột nào.
 *
 * Giờ mỗi cột là `h-full` (100% của khung `h-40` = 160px, xác định) và tự dồn
 * thanh xuống đáy bằng `flex-col justify-end`; phần trăm của thanh tính trên
 * 160px đó. Không còn phụ thuộc vào luật "kéo giãn" của flexbox.
 *
 * ---
 * SỐ LIỆU CÓ CẢ Ở DẠNG BẢNG
 *
 * Biểu đồ cột không đọc được bằng trình đọc màn hình. `<table>` ẩn bên dưới
 * mang đúng dữ liệu đó — không phải bản tóm tắt, mà chính nó.
 */
export function RevenueChart({
  rows,
}: {
  rows: { date: string; bookings: number; revenue: number }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
        Chưa có lượt đặt nào đã chốt trong khoảng này.
      </p>
    );
  }

  const max = Math.max(...rows.map((row) => row.revenue), 1);

  return (
    <figure className="rounded-token-lg border border-line bg-surface p-4">
      <div className="flex h-40 min-w-0 items-end gap-1" aria-hidden>
        {rows.map((row) => (
          <div
            key={row.date}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${row.date.slice(8)}/${row.date.slice(5, 7)} · ${formatVndShort(row.revenue)}`}
          >
            <div
              className="w-full rounded-t-[3px] bg-brand transition-opacity group-hover:opacity-80"
              style={{ height: `${columnHeightPercent(row.revenue, max)}%` }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs text-subtle">
        <span>
          {rows[0]!.date.slice(8)}/{rows[0]!.date.slice(5, 7)}
        </span>
        <span>cao nhất {formatVndShort(max)}</span>
        <span>
          {rows.at(-1)!.date.slice(8)}/{rows.at(-1)!.date.slice(5, 7)}
        </span>
      </div>

      <table className="sr-only">
        <caption>Doanh thu theo ngày</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th>
            <th scope="col">Số lượt</th>
            <th scope="col">Doanh thu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <th scope="row">{row.date}</th>
              <td>{row.bookings}</td>
              <td>{row.revenue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Chiều cao cột theo phần trăm của khung. Ngày có doanh thu nhưng nhỏ vẫn cao
 * tối thiểu 2% để thấy được là "có", không lẫn với ngày trống.
 */
export function columnHeightPercent(revenue: number, max: number): number {
  if (revenue <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, (revenue / max) * 100));
}
