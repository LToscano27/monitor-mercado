'use client';

import { useEffect, useState } from 'react';
import estilos from './Tablero.module.css';

type Tema = 'system' | 'light' | 'dark';

const OPCIONES: { valor: Tema; etiqueta: string; titulo: string }[] = [
  { valor: 'light', etiqueta: 'Claro', titulo: 'Modo claro' },
  { valor: 'system', etiqueta: 'Auto', titulo: 'Seguir el sistema' },
  { valor: 'dark', etiqueta: 'Oscuro', titulo: 'Modo oscuro' },
];

export function SelectorTema() {
  const [tema, setTema] = useState<Tema>('system');

  useEffect(() => {
    try {
      const guardado = localStorage.getItem('tema');
      if (guardado === 'light' || guardado === 'dark') setTema(guardado);
    } catch {
      /* almacenamiento bloqueado: queda en 'system' */
    }
  }, []);

  const elegir = (valor: Tema) => {
    setTema(valor);
    try {
      if (valor === 'system') {
        localStorage.removeItem('tema');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('tema', valor);
        document.documentElement.dataset.theme = valor;
      }
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
