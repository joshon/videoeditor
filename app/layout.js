import '../design-system/styles.css';
import './globals.css';

export const metadata = {
  title: 'Cutroom',
  description: 'Local video editor — projects are saved to disk in the projects folder',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-mode="2">
      <body>{children}</body>
    </html>
  );
}
