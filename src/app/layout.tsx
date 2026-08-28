import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Archivo es de Omnibus-Type, fundidora de Buenos Aires. La eligió el tema:
// el instrumento que muestra esta pantalla es deuda del Tesoro argentino.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--fuente-ui',
  display: 'swap',
});

// Mono para toda cifra y todo ticker.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--fuente-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Monitor · Renta fija en pesos',
  description:
    'Curva, precios y variación diaria del universo de tasa fija en pesos del Tesoro argentino.',
};

/**
 * Aplica el tema guardado antes del primer pintado para que no haya destello
 * de modo claro en un equipo configurado en oscuro.
 */
const TEMA_INICIAL = `
try {
  var t = localStorage.getItem('tema');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${archivo.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INICIAL }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
