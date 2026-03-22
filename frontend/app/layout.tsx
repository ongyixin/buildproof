import type { Metadata } from 'next'
import './globals.css'
import { SolanaProvider } from './providers'

export const metadata: Metadata = {
  title: 'BuildProof — Bittensor Diligence Subnet',
  description:
    'Real-time proposal evaluation powered by competing Bittensor miner neurons. Quality · Calibration · Robustness · Efficiency.',
  openGraph: {
    title: 'BuildProof',
    description: 'Bittensor-powered proposal evaluation subnet demo',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Fira+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,600&family=Source+Sans+3:wght@300;400;500;600&family=Barlow:wght@300;400;500;600;700&family=Share+Tech+Mono&family=DM+Sans:wght@300;400;500;600;700&family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Literata:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased font-mono">
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  )
}
