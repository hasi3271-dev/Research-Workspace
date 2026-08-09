import "./globals.css";
export const metadata = {
  title: "Research Workspace",
  description: "Research productivity workspace for projects, papers, notes, experiences, job search and AI workflows."
};
export default function RootLayout({children}) {
  return <html lang="ko"><body>{children}</body></html>;
}
