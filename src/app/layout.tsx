import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "When2meet+",
  description: "모두가 되는 시간을 찾고, 결과를 엑셀로 가져가세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="top">
          <a href="/" className="brand">When2meet<span>+</span></a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
