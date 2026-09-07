import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Conciliação M8", description: "Conciliação bancária e baixa de parcelas no ERP M8" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
