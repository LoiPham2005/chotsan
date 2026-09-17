import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { TopProgressBar } from "@/components/layout/top-progress-bar";
import { Footer } from "@/components/layout/footer";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "vietnamese"],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ChốtSân — Đặt sân thể thao 24/7",
    template: "%s · ChốtSân",
  },
  description:
    "Đặt sân cầu lông, bóng đá, tennis, pickleball, bóng rổ. Xem lịch trống theo khung 30 phút, chốt sân trong 30 giây.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10b981",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={beVietnamPro.variable} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col justify-between">
        {/*
          `useSearchParams()` bắt buộc phải nằm trong Suspense, nếu không toàn
          bộ trang bị đẩy sang dựng-lúc-chạy và mất hết lợi ích tĩnh.
        */}
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        <Header />
        {/*
          `<main>` ĐÚNG MỘT LẦN cho mọi trang, đặt ở đây. Trình đọc màn hình nhảy
          thẳng tới vùng "main" để bỏ qua thanh điều hướng — trước đây khu
          khách/chủ sân không có vùng nào, còn khu quản trị có hai vùng lồng nhau.
          Trang và layout con KHÔNG tự đặt `<main>` nữa.
        */}
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
