import './globals.css'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import { Providers } from './providers'

export const metadata = {
  title: 'SM-2 Race Control',
  description: 'Professional motorsport management system',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navbar />
            <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
              {children}
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}
