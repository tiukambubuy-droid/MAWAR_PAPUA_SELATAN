import type { Metadata } from "next";
import "./login.css";

export const metadata: Metadata = {
  title: "Masuk | MAWAR Papua Selatan",
  description: "Akses terbatas dashboard MAWAR Papua Selatan.",
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
