import { redirect } from 'next/navigation';
import { listUniverses } from '@/lib/universes';

export default function Inicio() {
  redirect(`/${listUniverses()[0].slug}`);
}
