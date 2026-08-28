'use client';

import { useEffect, useState } from 'react';
import estilos from './Tablero.module.css';

type Tema = 'light' | 'dark';

const OPCIONES: { valor: Tema; etiqueta: string; titulo: string }[] = [
  { valor: 'light', etiqueta: 'Claro', titulo: 'Modo claro' },
  { valor: 'dark', etiqueta: 'Oscuro', titulo: 'Modo oscuro' },
];

export function SelectorTema() {
  const [tema, setTema] = useState<Tema>('light');

  // Sin elección guardada arranca en lo que use el sistema, pero se muestra
  // resuelto: uno de los dos botones siempre está activo. Recién al tocar uno
  // se estampa el tema y se guarda.
  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = localStorage.getItem('tema');
    } catch {
      /* almacenamiento bloqueado */
    }
    if (guardado === 'light' || guardado === 'dark') {
      setTema(guardado);
      return;
    }
    setTema(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);

  const elegir = (valor: Tema) => {
    setTema(valor);
    document.documentElement.dataset.theme = valor;
    try {
      localStorage.setItem('tema', valor);
    } catch {
      /* sin persistencia, el cambio vale para esta sesión */
    }
  };

  return (
    <div className={estilos.segmentadoChico} role="group" aria-label="Tema">
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          title={o.titulo}
          aria-pressed={tema === o.valor}
          onClick={() => elegir(o.valor)}
          className={estilos.segmento}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
